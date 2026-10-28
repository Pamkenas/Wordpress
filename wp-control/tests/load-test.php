<?php
/**
 * Load and stress test for WP Control. Local test sites only.
 *
 * It fires many requests at the same time to see if the sites slow down,
 * return errors or fall over, and whether they recover afterwards. It watches
 * HTTP status, connection failures, latency, throughput, PHP errors, the
 * database and the Agent nonce store.
 *
 * It only reads. It never changes site content.
 *
 * Usage (from the wp-control folder):
 *   C:\xampp\php\php.exe tests\load-test.php
 *   C:\xampp\php\php.exe tests\load-test.php --concurrency 50 --seconds 60
 *   C:\xampp\php\php.exe tests\load-test.php --target dashboard
 *   C:\xampp\php\php.exe tests\load-test.php --target all
 *
 *   --target agent | dashboard | front | all   what to hit (default agent)
 *   --concurrency N                             requests in flight (default 30)
 *   --seconds S                                 how long per target (default 30)
 *
 * Heavy runs can crash MySQL on this machine. If that happens, see
 * memory/local-dev-environment.md for the repair steps.
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

const ROUTE   = '/wp-control-agent/v1/snapshot';
const MANAGER = 'http://localhost/wpc-manager';
const CLIENTS = array( 'wpc-client-a', 'wpc-client-b' );
const PHP_BIN = 'C:\\xampp\\php\\php.exe';
const MYSQL   = 'C:\\xampp\\mysql\\bin\\mysql.exe';

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

function option( $name, $default ) {
	global $argv;
	foreach ( $argv as $i => $arg ) {
		if ( $arg === $name ) {
			return $argv[ $i + 1 ] ?? $default;
		}
	}
	return $default;
}

function stop_with( $message ) {
	fwrite( STDERR, $message . "\n" );
	exit( 1 );
}

function request_signature( $secret, $method, $route, $timestamp, $nonce ) {
	return hash_hmac( 'sha256', implode( "\n", array( 'request', $method, $route, $timestamp, $nonce ) ), $secret );
}

function nonce() {
	return bin2hex( random_bytes( 16 ) );
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

function agent_endpoint( $site ) {
	return 'http://localhost/' . $site . '/?rest_route=' . rawurlencode( ROUTE );
}

function login_cookie( $base, $password ) {
	$headers = array();
	$ch      = curl_init( $base . '/wp-login.php' );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER  => true,
			CURLOPT_FOLLOWLOCATION  => false,
			CURLOPT_POST            => true,
			CURLOPT_HTTPHEADER      => array( 'Cookie: wordpress_test_cookie=WP Cookie check' ),
			CURLOPT_POSTFIELDS      => http_build_query( array( 'log' => 'admin', 'pwd' => $password, 'wp-submit' => 'Log In', 'testcookie' => '1', 'redirect_to' => $base . '/wp-admin/' ) ),
			CURLOPT_HEADERFUNCTION  => function ( $curl, $line ) use ( &$headers ) {
				$headers[] = $line;
				return strlen( $line );
			},
		)
	);
	curl_exec( $ch );
	$pairs = array();
	foreach ( $headers as $line ) {
		if ( preg_match( '/^Set-Cookie:\s*([^=]+=[^;]+)/i', $line, $match ) ) {
			$pairs[] = trim( $match[1] );
		}
	}
	return implode( '; ', $pairs );
}

function handle( $url, $headers = array() ) {
	$ch   = curl_init( $url );
	$list = array();
	foreach ( $headers as $name => $value ) {
		$list[] = $name . ': ' . $value;
	}
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HTTPHEADER     => $list,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_CONNECTTIMEOUT => 10,
			CURLOPT_FOLLOWLOCATION => false,
			CURLOPT_NOSIGNAL       => true,
		)
	);
	return $ch;
}

function agent_factory( $secret ) {
	return function () use ( $secret ) {
		$site = CLIENTS[ array_rand( CLIENTS ) ];
		$ts   = (string) time();
		$id   = nonce();
		return handle(
			agent_endpoint( $site ),
			array(
				'Accept'          => 'application/json',
				'X-WPC-Timestamp' => $ts,
				'X-WPC-Nonce'     => $id,
				'X-WPC-Signature' => request_signature( $secret, 'GET', ROUTE, $ts, $id ),
				'X-WPC-Manager'   => MANAGER,
			)
		);
	};
}

function dashboard_factory( $cookie ) {
	$views = array( 'overview', 'websites', 'clients', 'activity', 'backups', 'security' );
	return function () use ( $cookie, $views ) {
		$view = $views[ array_rand( $views ) ];
		return handle( MANAGER . '/wp-admin/admin.php?page=wp-control&view=' . $view, array( 'Cookie' => $cookie ) );
	};
}

function front_factory() {
	return function () {
		$site = CLIENTS[ array_rand( CLIENTS ) ];
		return handle( 'http://localhost/' . $site . '/' );
	};
}

function percentile( $sorted, $p ) {
	if ( empty( $sorted ) ) {
		return 0;
	}
	$index = (int) ceil( $p / 100 * count( $sorted ) ) - 1;
	return $sorted[ max( 0, min( $index, count( $sorted ) - 1 ) ) ];
}

function load_phase( $label, $factory, $concurrency, $seconds ) {
	heading( "== Load: $label, $concurrency at a time for $seconds s ==" );

	$mh    = curl_multi_init();
	$start = array();
	$lat   = array();
	$codes = array();
	$errors = 0;
	$sent   = 0;

	$add = function () use ( &$start, $mh, $factory ) {
		$ch = $factory();
		$start[ spl_object_id( $ch ) ] = microtime( true );
		curl_multi_add_handle( $mh, $ch );
	};

	for ( $i = 0; $i < $concurrency; $i++ ) {
		$add();
	}

	$deadline = microtime( true ) + $seconds;
	$began    = microtime( true );
	$tick     = microtime( true );

	while ( true ) {
		if ( microtime( true ) >= $deadline && empty( $start ) ) {
			break;
		}
		curl_multi_exec( $mh, $running );
		curl_multi_select( $mh, 0.1 );

		while ( $info = curl_multi_info_read( $mh ) ) {
			$ch   = $info['handle'];
			$id   = spl_object_id( $ch );
			$took = ( microtime( true ) - ( $start[ $id ] ?? microtime( true ) ) ) * 1000;
			$code = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
			++$sent;
			if ( CURLE_OK !== $info['result'] ) {
				++$errors;
			} else {
				$lat[]                 = $took;
				$codes[ $code ]        = ( $codes[ $code ] ?? 0 ) + 1;
			}
			curl_multi_remove_handle( $mh, $ch );
			unset( $start[ $id ] );
			if ( microtime( true ) < $deadline ) {
				$add();
			}
		}

		if ( microtime( true ) - $tick >= 2 ) {
			$tick    = microtime( true );
			$elapsed = microtime( true ) - $began;
			$rate    = $elapsed > 0 ? $sent / $elapsed : 0;
			$bad     = $errors + ( $codes[500] ?? 0 ) + ( $codes[502] ?? 0 ) + ( $codes[503] ?? 0 );
			$pct     = $sent > 0 ? 100 * $bad / $sent : 0;
			printf(
				"  %4.0fs | sent %6d | %6.0f req/s | in flight %3d | errors %d | %s\n",
				$elapsed,
				$sent,
				$rate,
				count( $start ),
				$errors,
				$pct > 0 ? paint( sprintf( '%.1f%% failed', $pct ), '31' ) : '0.0% failed'
			);
		}
	}

	curl_multi_close( $mh );

	sort( $lat );
	$elapsed = max( 0.001, microtime( true ) - $began );
	$server  = ( $codes[500] ?? 0 ) + ( $codes[502] ?? 0 ) + ( $codes[503] ?? 0 ) + ( $codes[504] ?? 0 );
	$ok      = ( $codes[200] ?? 0 ) + ( $codes[302] ?? 0 );

	echo "  ----\n";
	printf( "  sent %d in %.1fs = %.0f req/s\n", $sent, $elapsed, $sent / $elapsed );
	echo '  status: ';
	ksort( $codes );
	$parts = array();
	foreach ( $codes as $code => $count ) {
		$parts[] = $code . ' x' . $count;
	}
	echo ( $parts ? implode( ', ', $parts ) : 'none' ) . "\n";
	printf( "  latency: p50 %.0f ms, p90 %.0f ms, p99 %.0f ms, max %.0f ms\n", percentile( $lat, 50 ), percentile( $lat, 90 ), percentile( $lat, 99 ), end( $lat ) ?: 0 );
	echo '  connection failures: ' . ( $errors > 0 ? paint( (string) $errors, '31' ) : '0' ) . "\n";
	echo '  server errors (5xx): ' . ( $server > 0 ? paint( (string) $server, '31' ) : '0' ) . "\n";

	return array(
		'sent'    => $sent,
		'ok'      => $ok,
		'errors'  => $errors,
		'server'  => $server,
	);
}

$wpc_target      = option( '--target', 'agent' );
$wpc_concurrency = max( 1, (int) option( '--concurrency', 30 ) );
$wpc_seconds     = max( 1, (int) option( '--seconds', 30 ) );

if ( ! in_array( $wpc_target, array( 'agent', 'dashboard', 'front', 'all' ), true ) ) {
	stop_with( 'Unknown --target. Use agent, dashboard, front or all.' );
}
if ( ! is_file( dirname( __DIR__ ) . '/.env' ) ) {
	stop_with( 'Run tools/setup-test-sites.php first (no .env found).' );
}
$wpc_password = parse_ini_file( dirname( __DIR__ ) . '/.env', false, INI_SCANNER_RAW )['WPC_TEST_PASSWORD'] ?? '';

if ( ! mysql_up() ) {
	stop_with( 'MySQL is not answering. Start MySQL in XAMPP first.' );
}

$wpc_secret = '';
foreach ( CLIENTS as $wpc_site ) {
	$probe = helper( $wpc_site, 'has-key' );
	if ( 'yes' !== $probe && 'no' !== $probe ) {
		stop_with( "Refusing: $wpc_site is not a local test site." );
	}
	$key = helper( $wpc_site, 'get-secret' );
	if ( preg_match( '/^wpc1-[a-f0-9]{64}$/', $key ) ) {
		$wpc_secret = $key;
	}
}
if ( ( 'agent' === $wpc_target || 'all' === $wpc_target ) && '' === $wpc_secret ) {
	stop_with( 'No connection key on the client sites. Run tools/demo-data.php first.' );
}

echo paint( 'Load test — local test sites only. This can crash MySQL on this machine.', '33' ) . "\n";

$wpc_sites   = array( 'manager', 'wpc-client-a', 'wpc-client-b' );
$wpc_offsets = array();
foreach ( $wpc_sites as $wpc_name ) {
	$wpc_file                 = log_file( $wpc_name );
	$wpc_offsets[ $wpc_name ] = is_file( $wpc_file ) ? filesize( $wpc_file ) : 0;
}
$wpc_nonce_before = (int) mysql_value( "SELECT COALESCE(LENGTH(option_value), 0) FROM wpc_client_a.wp_options WHERE option_name = 'wp_control_agent_nonces'" );

$wpc_phases = array();
if ( 'agent' === $wpc_target || 'all' === $wpc_target ) {
	$wpc_phases['Agent snapshot (signed)'] = agent_factory( $wpc_secret );
}
if ( 'dashboard' === $wpc_target || 'all' === $wpc_target ) {
	$wpc_phases['Manager dashboard (logged in)'] = dashboard_factory( login_cookie( MANAGER, $wpc_password ) );
}
if ( 'front' === $wpc_target || 'all' === $wpc_target ) {
	$wpc_phases['Client front pages'] = front_factory();
}

$wpc_results = array();
foreach ( $wpc_phases as $wpc_label => $wpc_factory ) {
	$wpc_results[ $wpc_label ] = load_phase( $wpc_label, $wpc_factory, $wpc_concurrency, $wpc_seconds );
}

heading( '== After the load: did the sites survive? ==' );

$wpc_db_up = mysql_up();
echo 'database still answering: ' . ( $wpc_db_up ? paint( 'yes', '32' ) : paint( 'NO', '31' ) ) . "\n";

$wpc_recovered = 0;
$wpc_check     = array( MANAGER . '/wp-login.php', 'http://localhost/wpc-client-a/', 'http://localhost/wpc-client-b/' );
foreach ( $wpc_check as $wpc_url ) {
	$ch = handle( $wpc_url );
	curl_exec( $ch );
	$code = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
	$good = $code >= 200 && $code < 400;
	$wpc_recovered += $good ? 1 : 0;
	echo '  ' . ( $good ? paint( 'ok  ', '32' ) : paint( 'FAIL', '31' ) ) . ' ' . $wpc_url . ' -> HTTP ' . $code . "\n";
}

$wpc_log_problems = 0;
foreach ( $wpc_offsets as $wpc_name => $wpc_offset ) {
	foreach ( new_log_problems( $wpc_name, $wpc_offset ) as $wpc_line ) {
		++$wpc_log_problems;
		echo '  ' . paint( 'FAIL', '31' ) . ' PHP error on ' . $wpc_name . ': ' . $wpc_line . "\n";
	}
}
if ( 0 === $wpc_log_problems ) {
	echo '  ' . paint( 'ok  ', '32' ) . " no new PHP errors in the debug logs\n";
}

$wpc_nonce_after = (int) mysql_value( "SELECT COALESCE(LENGTH(option_value), 0) FROM wpc_client_a.wp_options WHERE option_name = 'wp_control_agent_nonces'" );

heading( '== Summary ==' );
$wpc_total_sent   = 0;
$wpc_total_errors = 0;
$wpc_total_server = 0;
foreach ( $wpc_results as $wpc_label => $wpc_r ) {
	printf( "%-32s sent %6d | ok %6d | conn-fail %d | 5xx %d\n", $wpc_label, $wpc_r['sent'], $wpc_r['ok'], $wpc_r['errors'], $wpc_r['server'] );
	$wpc_total_sent   += $wpc_r['sent'];
	$wpc_total_errors += $wpc_r['errors'];
	$wpc_total_server += $wpc_r['server'];
}
if ( $wpc_nonce_before > 0 || $wpc_nonce_after > 0 ) {
	printf( "Agent nonce store on wpc-client-a: %d B -> %d B (prunes itself after 600 s)\n", $wpc_nonce_before, $wpc_nonce_after );
}

$wpc_survived = $wpc_db_up && 3 === $wpc_recovered && 0 === $wpc_log_problems && 0 === $wpc_total_server && 0 === $wpc_total_errors;
echo "\n" . ( $wpc_survived
	? paint( 'The sites handled the load and stayed up.', '32;1' )
	: paint( 'The load caused errors — see above.', '31;1' ) ) . "\n";
exit( $wpc_survived ? 0 : 1 );
