<?php
/**
 * Soak and security harness for WP Control. Local test sites only.
 *
 * It does two things:
 *   1. Security regression: it acts as an outside caller and tries many bad
 *      requests against the Agent, then checks the Agent refuses each one and
 *      accepts only a correctly signed request. It also checks the Manager's
 *      web pages and REST API, and that connection keys are stored encrypted.
 *   2. Soak: for a while it keeps calling the Agent (good and bad requests),
 *      and watches for PHP errors, a lost database, slow answers or a growing
 *      nonce store.
 *
 * It never changes site content. It reads the keys the sites already have.
 *
 * Usage (from the wp-control folder):
 *   C:\xampp\php\php.exe tests\soak-and-security.php                 10 minutes
 *   C:\xampp\php\php.exe tests\soak-and-security.php --minutes 60
 *   C:\xampp\php\php.exe tests\soak-and-security.php --minutes 0     security only
 *   C:\xampp\php\php.exe tests\soak-and-security.php --sync          also sync each cycle
 *
 * Stop early with Ctrl-C, or create the file tests\soak.stop.
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

const ROUTE   = '/wp-control-agent/v1/snapshot';
const MANAGER = 'http://localhost/wpc-manager';
const CLIENTS = array( 'wpc-client-a', 'wpc-client-b' );
const PHP_BIN = 'C:\\xampp\\php\\php.exe';
const MYSQL   = 'C:\\xampp\\mysql\\bin\\mysql.exe';
const SKEW    = 300;

$wpc_passed = 0;
$wpc_failed = 0;

$wpc_color = function_exists( 'stream_isatty' ) ? stream_isatty( STDOUT ) : true;
if ( $wpc_color && function_exists( 'sapi_windows_vt100_support' ) ) {
	$wpc_color = sapi_windows_vt100_support( STDOUT, true );
}

function paint( $text, $code ) {
	global $wpc_color;
	return $wpc_color ? "\033[" . $code . 'm' . $text . "\033[0m" : $text;
}

function heading( $text ) {
	echo "\n" . paint( $text, '36;1' ) . "\n";
}

function sign( $secret, $parts ) {
	return hash_hmac( 'sha256', implode( "\n", $parts ), $secret );
}

function request_signature( $secret, $method, $route, $timestamp, $nonce ) {
	return sign( $secret, array( 'request', $method, $route, $timestamp, $nonce ) );
}

function response_signature( $secret, $nonce, $payload ) {
	return sign( $secret, array( 'response', $nonce, hash( 'sha256', $payload ) ) );
}

function nonce() {
	return bin2hex( random_bytes( 16 ) );
}

function option( $name, $default = null ) {
	global $argv;
	foreach ( $argv as $i => $arg ) {
		if ( $arg === $name ) {
			return $argv[ $i + 1 ] ?? true;
		}
	}
	return $default;
}

function flag( $name ) {
	global $argv;
	return in_array( $name, $argv, true );
}

function check( $condition, $label ) {
	global $wpc_passed, $wpc_failed;
	echo ( $condition ? paint( 'ok', '32' ) . '    ' : paint( 'FAIL', '31' ) . '  ' ) . $label . "\n";
	$condition ? ++$wpc_passed : ++$wpc_failed;
}

function stop_with( $message ) {
	fwrite( STDERR, $message . "\n" );
	exit( 1 );
}

function helper( $site, $command ) {
	$line = escapeshellarg( PHP_BIN ) . ' ' . escapeshellarg( __DIR__ . '/agent-helper.php' ) . ' ' . escapeshellarg( $site ) . ' ' . escapeshellarg( $command );
	return trim( (string) shell_exec( $line ) );
}

function mysql_value( $sql ) {
	$line = escapeshellarg( MYSQL ) . ' -u root -N -e ' . escapeshellarg( $sql ) . ' 2>&1';
	return trim( (string) shell_exec( $line ) );
}

function mysql_up() {
	return '1' === mysql_value( 'SELECT 1' );
}

function agent_endpoint( $site ) {
	return 'http://localhost/' . $site . '/?rest_route=' . rawurlencode( ROUTE );
}

function request( $url, $headers = array(), $method = 'GET', $cookies = null, $post = null ) {
	$curl = curl_init( $url );
	$list = array();
	foreach ( $headers as $name => $value ) {
		$list[] = $name . ': ' . $value;
	}
	curl_setopt_array(
		$curl,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HEADER         => true,
			CURLOPT_HTTPHEADER     => $list,
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_FOLLOWLOCATION => false,
		)
	);
	if ( null !== $cookies ) {
		curl_setopt( $curl, CURLOPT_COOKIEJAR, $cookies );
		curl_setopt( $curl, CURLOPT_COOKIEFILE, $cookies );
	}
	if ( null !== $post ) {
		curl_setopt( $curl, CURLOPT_POST, true );
		curl_setopt( $curl, CURLOPT_POSTFIELDS, http_build_query( $post ) );
	}
	$started  = microtime( true );
	$raw      = (string) curl_exec( $curl );
	$ms       = ( microtime( true ) - $started ) * 1000;
	$size     = curl_getinfo( $curl, CURLINFO_HEADER_SIZE );
	$code     = (int) curl_getinfo( $curl, CURLINFO_RESPONSE_CODE );
	$head     = substr( $raw, 0, $size );
	$body     = substr( $raw, $size );
	$location = preg_match( '/^Location: (.+)$/mi', $head, $match ) ? trim( $match[1] ) : '';
	return array(
		'code'     => $code,
		'headers'  => $head,
		'body'     => $body,
		'json'     => json_decode( $body, true ),
		'location' => $location,
		'ms'       => $ms,
	);
}

function signed_headers( $secret, $timestamp, $nonce, $method = 'GET', $route = ROUTE ) {
	return array(
		'Accept'          => 'application/json',
		'X-WPC-Timestamp' => (string) $timestamp,
		'X-WPC-Nonce'     => $nonce,
		'X-WPC-Signature' => request_signature( $secret, $method, $route, (string) $timestamp, $nonce ),
		'X-WPC-Manager'   => MANAGER,
	);
}

function error_code( $result ) {
	return is_array( $result['json'] ) && isset( $result['json']['code'] ) ? $result['json']['code'] : '';
}

function valid_fetch( $site, $secret ) {
	$ts    = time();
	$id    = nonce();
	return request( agent_endpoint( $site ), signed_headers( $secret, $ts, $id ) );
}

function log_in( $base, $cookies, $password ) {
	request( $base . '/wp-login.php', array(), 'GET', $cookies );
	return request(
		$base . '/wp-login.php',
		array(),
		'POST',
		$cookies,
		array(
			'log'         => 'admin',
			'pwd'         => $password,
			'wp-submit'   => 'Log In',
			'testcookie'  => '1',
			'redirect_to' => $base . '/wp-admin/',
		)
	);
}

$wpc_env = option( '--minutes', null );
if ( ! is_file( dirname( __DIR__ ) . '/.env' ) ) {
	stop_with( 'Run tools/setup-test-sites.php first (no .env found).' );
}
$wpc_password = parse_ini_file( dirname( __DIR__ ) . '/.env', false, INI_SCANNER_RAW )['WPC_TEST_PASSWORD'] ?? '';

if ( ! mysql_up() ) {
	stop_with( 'MySQL is not answering. Start MySQL in XAMPP first.' );
}

$wpc_secrets = array();
foreach ( CLIENTS as $wpc_site ) {
	if ( 'local' !== helper_environment( $wpc_site ) ) {
		stop_with( "Refusing: $wpc_site is not a local test site." );
	}
	$wpc_secret = helper( $wpc_site, 'get-secret' );
	if ( ! preg_match( '/^wpc1-[a-f0-9]{64}$/', $wpc_secret ) ) {
		stop_with( "No connection key on $wpc_site. Run tools/demo-data.php or pair the site first." );
	}
	$wpc_secrets[ $wpc_site ] = $wpc_secret;
}

function helper_environment( $site ) {
	$probe = helper( $site, 'has-key' );
	return ( 'yes' === $probe || 'no' === $probe ) ? 'local' : 'unknown';
}

heading( '== Security: the Agent must refuse every bad request ==' );

$wpc_site   = CLIENTS[0];
$wpc_secret = $wpc_secrets[ $wpc_site ];
$wpc_url    = agent_endpoint( $wpc_site );
$wpc_now    = time();

$r = request( $wpc_url );
check( 401 === $r['code'] && 'wpc_unsigned' === error_code( $r ), 'no signature headers -> 401 wpc_unsigned' );

$r = request( $wpc_url, signed_headers( $wpc_secret, $wpc_now, 'short' ) );
check( 401 === $r['code'] && 'wpc_unsigned' === error_code( $r ), 'bad nonce format -> 401 wpc_unsigned' );

$r = request( $wpc_url, array_merge( signed_headers( $wpc_secret, $wpc_now, nonce() ), array( 'X-WPC-Signature' => 'xyz' ) ) );
check( 401 === $r['code'] && 'wpc_unsigned' === error_code( $r ), 'bad signature format -> 401 wpc_unsigned' );

$r = request( $wpc_url, signed_headers( $wpc_secret, 'not-a-number', nonce() ) );
check( 401 === $r['code'] && 'wpc_unsigned' === error_code( $r ), 'non-numeric timestamp -> 401 wpc_unsigned' );

$r = request( $wpc_url, signed_headers( $wpc_secret, $wpc_now - SKEW - 100, nonce() ) );
check( 401 === $r['code'] && 'wpc_clock' === error_code( $r ), 'expired timestamp -> 401 wpc_clock' );

$r = request( $wpc_url, signed_headers( $wpc_secret, $wpc_now + SKEW + 100, nonce() ) );
check( 401 === $r['code'] && 'wpc_clock' === error_code( $r ), 'future timestamp -> 401 wpc_clock' );

$wpc_id = nonce();
$r      = request( $wpc_url, array_merge( signed_headers( $wpc_secret, $wpc_now, $wpc_id ), array( 'X-WPC-Signature' => str_repeat( '0', 64 ) ) ) );
check( 401 === $r['code'] && 'wpc_bad_signature' === error_code( $r ), 'wrong signature value -> 401 wpc_bad_signature' );

$r = request( $wpc_url, signed_headers( 'wpc1-' . str_repeat( 'a', 64 ), $wpc_now, nonce() ) );
check( 401 === $r['code'] && 'wpc_bad_signature' === error_code( $r ), 'signed with the wrong key -> 401 wpc_bad_signature' );

$wpc_id  = nonce();
$wpc_bad = signed_headers( $wpc_secret, $wpc_now, $wpc_id );
$wpc_bad['X-WPC-Signature'] = request_signature( $wpc_secret, 'POST', ROUTE, (string) $wpc_now, $wpc_id );
$r = request( $wpc_url, $wpc_bad );
check( 401 === $r['code'] && 'wpc_bad_signature' === error_code( $r ), 'signature for a different method -> 401 wpc_bad_signature' );

$wpc_id  = nonce();
$wpc_bad = signed_headers( $wpc_secret, $wpc_now, $wpc_id );
$wpc_bad['X-WPC-Signature'] = request_signature( $wpc_secret, 'GET', '/wp-control-agent/v1/other', (string) $wpc_now, $wpc_id );
$r = request( $wpc_url, $wpc_bad );
check( 401 === $r['code'] && 'wpc_bad_signature' === error_code( $r ), 'signature for a different route -> 401 wpc_bad_signature' );

$r = request( $wpc_url, signed_headers( $wpc_secret, $wpc_now, nonce() ), 'POST' );
check( 200 !== $r['code'], 'POST to the read-only endpoint is not accepted (HTTP ' . $r['code'] . ')' );

$wpc_ts    = time();
$wpc_id    = nonce();
$wpc_good  = request( $wpc_url, signed_headers( $wpc_secret, $wpc_ts, $wpc_id ) );
$wpc_reply = is_array( $wpc_good['json'] ) ? $wpc_good['json'] : array();
check( 200 === $wpc_good['code'] && isset( $wpc_reply['payload'], $wpc_reply['signature'] ), 'a correctly signed request is accepted (HTTP 200)' );
check(
	isset( $wpc_reply['payload'], $wpc_reply['signature'] ) && hash_equals( response_signature( $wpc_secret, $wpc_id, $wpc_reply['payload'] ), $wpc_reply['signature'] ),
	'the answer is signed with our key'
);

if ( isset( $wpc_reply['payload'], $wpc_reply['signature'] ) ) {
	$tampered = $wpc_reply['payload'] . ' ';
	check( ! hash_equals( response_signature( $wpc_secret, $wpc_id, $tampered ), $wpc_reply['signature'] ), 'a changed answer no longer matches the signature' );
}

$r = request( $wpc_url, signed_headers( $wpc_secret, $wpc_ts, $wpc_id ) );
check( 401 === $r['code'] && 'wpc_replay' === error_code( $r ), 'the same request sent twice is refused (replay) -> 401 wpc_replay' );

heading( '== Security: the Manager web pages and API ==' );

$wpc_cookies = tempnam( sys_get_temp_dir(), 'wpc' );
$wpc_login   = log_in( MANAGER, $wpc_cookies, $wpc_password );
check( 302 === $wpc_login['code'], 'the administrator can log in to the Manager' );

$wpc_rest = request( MANAGER . '/?rest_route=/wp-control/v1/sites', array(), 'GET', $wpc_cookies );
check( 401 === $wpc_rest['code'], 'the Manager REST API refuses a cookie login without the REST nonce -> 401' );

$wpc_post = request(
	MANAGER . '/wp-admin/admin-post.php',
	array(),
	'POST',
	$wpc_cookies,
	array(
		'action'   => 'wpc_save_client',
		'_wpnonce' => 'wrong',
		'name'     => 'Soak Should Not Save',
	)
);
check( 403 === $wpc_post['code'], 'a Manager form without a valid nonce is refused -> 403' );

$wpc_inject = request( MANAGER . '/wp-admin/admin.php?' . http_build_query( array( 'page' => 'wp-control', 'view' => 'websites', 's' => "' OR '1'='1" ) ), array(), 'GET', $wpc_cookies );
check( 200 === $wpc_inject['code'] && false === stripos( $wpc_inject['body'], 'database error' ) && false === strpos( $wpc_inject['body'], 'SQL syntax' ), 'a quote in the search box does not break the query (safe from SQL injection)' );

$wpc_xss = request( MANAGER . '/wp-admin/admin.php?' . http_build_query( array( 'page' => 'wp-control', 'view' => 'websites', 's' => '<script>alert(1)</script>' ) ), array(), 'GET', $wpc_cookies );
check( 200 === $wpc_xss['code'] && false === strpos( $wpc_xss['body'], '<script>alert(1)</script>' ), 'a script tag in the search box is escaped, not reflected (safe from XSS)' );

unlink( $wpc_cookies );

heading( '== Security: connection keys are stored encrypted ==' );

$wpc_plain = mysql_value( "SELECT COUNT(*) FROM wpc_manager.wp_wpc_agents WHERE LEFT(secret, 5) = 'wpc1-'" );
$wpc_rows  = mysql_value( 'SELECT COUNT(*) FROM wpc_manager.wp_wpc_agents' );
$wpc_enc   = mysql_value( "SELECT COUNT(*) FROM wpc_manager.wp_wpc_agents WHERE LEFT(secret, 3) = 'v1:'" );
check( '0' === $wpc_plain, 'no connection key is stored in plain text in the Manager database' );
check( (int) $wpc_rows > 0 && $wpc_rows === $wpc_enc, "every stored key is encrypted (v1:) ($wpc_enc of $wpc_rows)" );

echo "\n" . paint( $wpc_passed . ' passed', '32' ) . ', ' . ( $wpc_failed > 0 ? paint( $wpc_failed . ' failed', '31' ) : '0 failed' ) . " in the security checks\n";

$wpc_minutes = (int) ( null === $wpc_env ? 10 : $wpc_env );
if ( $wpc_minutes <= 0 ) {
	echo "\nSoak skipped (--minutes 0).\n";
	exit( $wpc_failed > 0 ? 1 : 0 );
}

heading( "== Soak: hammering the Agent for $wpc_minutes minute(s) ==" );
echo "Stop early with Ctrl-C or by creating tests\\soak.stop\n\n";

$wpc_sync_each = flag( '--sync' );
$wpc_stop_file = __DIR__ . '/soak.stop';
@unlink( $wpc_stop_file );

$wpc_sites   = array( 'manager' => MANAGER ) + array_combine( CLIENTS, array_map( fn( $s ) => 'http://localhost/' . $s, CLIENTS ) );
$wpc_offsets = array();
foreach ( $wpc_sites as $wpc_name => $wpc_base ) {
	$wpc_file                 = log_file( $wpc_name );
	$wpc_offsets[ $wpc_name ] = is_file( $wpc_file ) ? filesize( $wpc_file ) : 0;
}

function log_file( $name ) {
	$folder = 'manager' === $name ? 'wpc-manager' : $name;
	return 'C:/xampp/htdocs/' . $folder . '/wp-content/debug.log';
}

function new_log_problems( $name, $offset ) {
	$file = log_file( $name );
	if ( ! is_file( $file ) || filesize( $file ) <= $offset ) {
		return array();
	}
	$text  = (string) file_get_contents( $file, false, null, $offset );
	$lines = array();
	foreach ( explode( "\n", $text ) as $line ) {
		if ( preg_match( '/PHP (Fatal|Parse|Recoverable)|Uncaught/', $line ) ) {
			$lines[] = trim( $line );
		} elseif ( preg_match( '/PHP (Warning|Notice|Deprecated)/', $line ) && false !== stripos( $line, 'wp-control' ) ) {
			$lines[] = trim( $line );
		}
	}
	return $lines;
}

function manager_sync_all() {
	$cookies = tempnam( sys_get_temp_dir(), 'wpc' );
	global $wpc_password;
	log_in( MANAGER, $cookies, $wpc_password );
	$page  = request( MANAGER . '/wp-admin/admin.php?page=wp-control&view=websites', array(), 'GET', $cookies );
	$nonce = preg_match( '/name="_wpnonce" value="([a-f0-9]+)".{0,400}?name="action" value="wpc_sync_all"/s', $page['body'], $m ) ? $m[1] : '';
	if ( '' === $nonce ) {
		$nonce = preg_match( '/name="action" value="wpc_sync_all".{0,400}?name="_wpnonce" value="([a-f0-9]+)"/s', $page['body'], $m2 ) ? $m2[1] : '';
	}
	if ( '' !== $nonce ) {
		request( MANAGER . '/wp-admin/admin-post.php', array(), 'POST', $cookies, array( 'action' => 'wpc_sync_all', '_wpnonce' => $nonce ) );
	}
	unlink( $cookies );
	return '' !== $nonce;
}

$wpc_cycle    = 0;
$wpc_good_ok  = 0;
$wpc_bad_ok   = 0;
$wpc_problems = 0;
$wpc_lat      = array();
foreach ( CLIENTS as $wpc_site ) {
	$wpc_lat[ $wpc_site ] = array();
}
$wpc_deadline = time() + $wpc_minutes * 60;
$wpc_report   = time();

while ( time() < $wpc_deadline && ! is_file( $wpc_stop_file ) ) {
	++$wpc_cycle;

	foreach ( CLIENTS as $wpc_site ) {
		$r = valid_fetch( $wpc_site, $wpc_secrets[ $wpc_site ] );
		if ( 200 === $r['code'] && is_array( $r['json'] ) && isset( $r['json']['payload'] ) ) {
			++$wpc_good_ok;
			$wpc_lat[ $wpc_site ][] = $r['ms'];
		}

		$bad = array(
			request( agent_endpoint( $wpc_site ) ),
			request( agent_endpoint( $wpc_site ), signed_headers( $wpc_secrets[ $wpc_site ], time() - SKEW - 100, nonce() ) ),
			request( agent_endpoint( $wpc_site ), array_merge( signed_headers( $wpc_secrets[ $wpc_site ], time(), nonce() ), array( 'X-WPC-Signature' => str_repeat( '0', 64 ) ) ) ),
		);
		foreach ( $bad as $one ) {
			if ( 401 === $one['code'] ) {
				++$wpc_bad_ok;
			} else {
				++$wpc_problems;
				echo paint( 'FAIL', '31' ) . '  a bad request to ' . $wpc_site . ' was not refused: HTTP ' . $one['code'] . "\n";
			}
		}
	}

	if ( $wpc_sync_each ) {
		manager_sync_all();
	}

	if ( time() - $wpc_report >= 20 ) {
		$wpc_report = time();

		if ( ! mysql_up() ) {
			++$wpc_problems;
			echo paint( 'FAIL', '31' ) . "  MySQL stopped answering during the soak\n";
			break;
		}

		foreach ( $wpc_offsets as $wpc_name => $wpc_offset ) {
			foreach ( new_log_problems( $wpc_name, $wpc_offset ) as $wpc_line ) {
				++$wpc_problems;
				echo paint( 'FAIL', '31' ) . '  PHP error on ' . $wpc_name . ': ' . $wpc_line . "\n";
			}
		}

		$left  = max( 0, $wpc_deadline - time() );
		$a     = $wpc_lat[ CLIENTS[0] ];
		$avg   = $a ? array_sum( $a ) / count( $a ) : 0;
		$nonce_bytes = (int) mysql_value( "SELECT COALESCE(LENGTH(option_value), 0) FROM wpc_client_a.wp_options WHERE option_name = 'wp_control_agent_nonces'" );
		printf(
			"cycle %d | %ds left | good %d, bad refused %d | %s avg %.0f ms | nonce store %d B | %s\n",
			$wpc_cycle,
			$left,
			$wpc_good_ok,
			$wpc_bad_ok,
			CLIENTS[0],
			$avg,
			$nonce_bytes,
			$wpc_problems > 0 ? paint( 'problems ' . $wpc_problems, '31' ) : 'problems 0'
		);
	}

	usleep( 200000 );
}

@unlink( $wpc_stop_file );

heading( '== Soak result ==' );
foreach ( CLIENTS as $wpc_site ) {
	$a = $wpc_lat[ $wpc_site ];
	if ( $a ) {
		printf( "%s latency: min %.0f ms, avg %.0f ms, max %.0f ms over %d calls\n", $wpc_site, min( $a ), array_sum( $a ) / count( $a ), max( $a ), count( $a ) );
	}
}
printf( "%d cycles, %d good answers, %d bad requests refused, %d problems\n", $wpc_cycle, $wpc_good_ok, $wpc_bad_ok, $wpc_problems );

$wpc_total_failed = $wpc_failed + $wpc_problems;
echo "\n" . ( 0 === $wpc_total_failed ? paint( 'All clear.', '32;1' ) : paint( $wpc_total_failed . ' problem(s) found.', '31;1' ) ) . "\n";
exit( $wpc_total_failed > 0 ? 1 : 0 );
