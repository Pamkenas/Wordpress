<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

function copy_plugin( $from, $to ) {
	if ( is_dir( $to ) ) {
		foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $to, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST ) as $item ) {
			$item->isDir() ? rmdir( $item->getPathname() ) : unlink( $item->getPathname() );
		}
		rmdir( $to );
	}
	mkdir( $to, 0755, true );
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $from, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST ) as $item ) {
		$target = $to . '/' . substr( $item->getPathname(), strlen( $from ) + 1 );
		$item->isDir() ? mkdir( $target ) : copy( $item->getPathname(), $target );
	}
}

copy_plugin( dirname( __DIR__ ) . '/wp-control-manager', 'C:/xampp/htdocs/wpc-manager/wp-content/plugins/wp-control-manager' );
copy_plugin( dirname( __DIR__ ) . '/wp-control-agent', 'C:/xampp/htdocs/wpc-client-a/wp-content/plugins/wp-control-agent' );
copy_plugin( dirname( __DIR__ ) . '/wp-control-agent', 'C:/xampp/htdocs/wpc-client-b/wp-content/plugins/wp-control-agent' );

define( 'DISABLE_WP_CRON', true );
$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['SERVER_NAME'] = 'localhost';
$_SERVER['REQUEST_URI'] = '/wpc-manager/wp-admin/admin.php';
require 'C:/xampp/htdocs/wpc-manager/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/user.php';
require_once dirname( __DIR__ ) . '/wp-control-agent/includes/signature.php';

use WPControlManager as M;

if ( 'http://localhost/wpc-manager' !== home_url() || 'local' !== wp_get_environment_type() ) {
	fwrite( STDERR, "Refusing: the tests only run on the local test site http://localhost/wpc-manager\n" );
	exit( 1 );
}

const CLIENT_A = 'wpc-client-a';
const CLIENT_B = 'wpc-client-b';
const TEST_PLUGIN = 'wpc-test-plugin/wpc-test-plugin.php';

class Died extends Exception {
}

$wpc_tests = array();
$wpc       = array();

function test( $name, $callback ) {
	global $wpc_tests;
	$wpc_tests[] = array( $name, $callback );
}

function ok( $condition, $message ) {
	if ( ! $condition ) {
		throw new Exception( $message );
	}
}

function same( $expected, $actual, $label ) {
	if ( $expected !== $actual ) {
		throw new Exception( $label . ': expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}

function contains( $text, $part, $label ) {
	if ( false === strpos( (string) $text, $part ) ) {
		throw new Exception( $label . ': "' . $part . '" is missing' );
	}
}

function not_contains( $text, $part, $label ) {
	if ( false !== strpos( (string) $text, $part ) ) {
		throw new Exception( $label . ': "' . $part . '" must not be there' );
	}
}

function expect_die( $callback, $label ) {
	try {
		$callback();
	} catch ( Died $died ) {
		return $died->getMessage();
	}
	throw new Exception( $label . ': expected the request to be refused' );
}

function agent( $site, ...$args ) {
	$command = escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __DIR__ . '/agent-helper.php' ) . ' ' . escapeshellarg( $site );
	foreach ( $args as $arg ) {
		$command .= ' ' . escapeshellarg( (string) $arg );
	}
	exec( $command . ' 2>&1', $output, $code );
	if ( 0 !== $code ) {
		throw new Exception( "agent helper failed ($site " . implode( ' ', $args ) . '): ' . implode( "\n", $output ) );
	}
	return implode( "\n", $output );
}

function agent_request( $site, $secret, $options = array() ) {
	$timestamp = (string) ( $options['timestamp'] ?? time() );
	$nonce     = $options['nonce'] ?? bin2hex( random_bytes( 16 ) );
	$method    = $options['method'] ?? 'GET';
	$headers   = array(
		'X-WPC-Timestamp' => $timestamp,
		'X-WPC-Nonce'     => $nonce,
		'X-WPC-Signature' => M\request_signature( $secret, $method, M\AGENT_ROUTE, $timestamp, $nonce ),
	);
	if ( ! empty( $options['unsigned'] ) ) {
		$headers = array();
	}
	$response = wp_remote_request(
		M\agent_url( 'http://localhost/' . $site ),
		array(
			'method'      => $method,
			'headers'     => $headers,
			'timeout'     => 60,
			'redirection' => 0,
		)
	);
	ok( ! is_wp_error( $response ), 'request failed: ' . ( is_wp_error( $response ) ? $response->get_error_message() : '' ) );
	return array(
		'code'  => (int) wp_remote_retrieve_response_code( $response ),
		'data'  => json_decode( wp_remote_retrieve_body( $response ), true ),
		'nonce' => $nonce,
	);
}

function sync( $site_id ) {
	$result = M\sync_site( $site_id, 'manual' );
	if ( is_wp_error( $result ) ) {
		throw new Exception( 'sync failed: ' . $result->get_error_message() );
	}
	return $result;
}

function sync_error( $site_id ) {
	$result = M\sync_site( $site_id, 'manual' );
	ok( is_wp_error( $result ), 'the sync should fail' );
	return $result->get_error_message();
}

function components_by_slug( $site_id ) {
	$list = array();
	foreach ( M\site_components( $site_id ) as $component ) {
		$list[ $component->slug ] = $component;
	}
	return $list;
}

function checks_by_key( $site_id ) {
	$list = array();
	foreach ( M\site_checks( $site_id ) as $item ) {
		$list[ $item->check_key ] = $item;
	}
	return $list;
}

function count_rows( $table, $site_id ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . M\table( $table ) . ' WHERE site_id = %d', $site_id ) );
}

function open_offers( $site_id ) {
	global $wpdb;
	return $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . M\table( 'update_offers' ) . ' WHERE site_id = %d AND resolved_at IS NULL', $site_id ) );
}

function render( $get ) {
	$_GET = $get;
	ob_start();
	try {
		M\render_app();
	} catch ( Throwable $error ) {
		ob_end_clean();
		$_GET = array();
		throw $error;
	}
	$_GET = array();
	return ob_get_clean();
}

function all_screens() {
	global $wpc;
	$pages = array();
	foreach ( array_keys( M\VIEWS ) as $view ) {
		$pages[ $view ] = render( array( 'view' => $view ) );
	}
	foreach ( array_keys( M\SITE_TABS ) as $tab ) {
		$pages[ 'site ' . $tab ] = render(
			array(
				'view' => 'overview',
				'site' => $wpc['site_a'],
				'tab'  => $tab,
			)
		);
	}
	foreach ( array_keys( M\ACTIVITY_TABS ) as $sub ) {
		$pages[ 'activity ' . $sub ] = render(
			array(
				'view' => 'activity',
				'sub'  => $sub,
			)
		);
	}
	return $pages;
}

function test_user( $role ) {
	$login = 'wpc_test_' . $role;
	$user  = get_user_by( 'login', $login );
	if ( $user ) {
		return $user->ID;
	}
	return wp_insert_user(
		array(
			'user_login' => $login,
			'user_pass'  => wp_generate_password( 24 ),
			'role'       => $role,
		)
	);
}

function fake_agent( $mode, $key = '' ) {
	$folder = 'C:/xampp/htdocs/wpc-fake-agent';
	if ( ! is_dir( $folder ) ) {
		mkdir( $folder );
	}
	file_put_contents( $folder . '/mode.txt', $mode );
	$code = '<?php
$key = ' . var_export( $key, true ) . ';
$mode = file_get_contents( __DIR__ . "/mode.txt" );
file_put_contents( __DIR__ . "/headers.txt", json_encode( getallheaders() ) );
if ( "redirect" === $mode ) {
	header( "Location: https://evil.example/steal" );
	http_response_code( 301 );
	exit;
}
$nonce = isset( $_SERVER["HTTP_X_WPC_NONCE"] ) ? $_SERVER["HTTP_X_WPC_NONCE"] : "";
$payload = json_encode( array( "schema" => 2 ) );
$signature = hash_hmac( "sha256", implode( "\n", array( "response", $nonce, hash( "sha256", $payload ) ) ), $key );
if ( "bad-signature" === $mode ) {
	$signature = str_repeat( "0", 64 );
}
header( "Content-Type: application/json" );
echo json_encode( array( "payload" => $payload, "signature" => $signature ) );
';
	file_put_contents( $folder . '/index.php', $code );
}

function remove_fake_agent() {
	foreach ( array( 'index.php', 'mode.txt', 'headers.txt' ) as $file ) {
		if ( is_file( 'C:/xampp/htdocs/wpc-fake-agent/' . $file ) ) {
			unlink( 'C:/xampp/htdocs/wpc-fake-agent/' . $file );
		}
	}
	if ( is_dir( 'C:/xampp/htdocs/wpc-fake-agent' ) ) {
		rmdir( 'C:/xampp/htdocs/wpc-fake-agent' );
	}
}

add_filter(
	'wp_die_handler',
	function () {
		return function ( $message ) {
			throw new Died( is_string( $message ) ? $message : 'wp_die' );
		};
	}
);

set_error_handler(
	function ( $level, $message, $file, $line ) {
		if ( ! ( error_reporting() & $level ) ) {
			return false;
		}
		$ours = false !== strpos( str_replace( '\\', '/', $file ), '/wp-control' );
		if ( ! $ours && in_array( $level, array( E_DEPRECATED, E_USER_DEPRECATED ), true ) ) {
			return false;
		}
		throw new ErrorException( "PHP warning: $message in $file:$line", 0, $level );
	}
);

test(
	'the Manager created its 12 tables and gave only administrators access',
	function () {
		global $wpdb;
		foreach ( M\TABLES as $name ) {
			same( M\table( $name ), $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', M\table( $name ) ) ), $name );
		}
		ok( get_role( 'administrator' )->has_cap( M\CAPABILITY ), 'administrators have the capability' );
		ok( ! get_role( 'editor' )->has_cap( M\CAPABILITY ), 'editors do not' );
	}
);

test(
	'Manager and Agent sign requests and answers the same way',
	function () {
		$secret = 'wpc1-' . str_repeat( 'ab', 32 );
		same( WPControlAgent\request_signature( $secret, 'GET', '/x', '1', 'n' ), M\request_signature( $secret, 'GET', '/x', '1', 'n' ), 'request' );
		same( WPControlAgent\response_signature( $secret, 'n', 'payload' ), M\response_signature( $secret, 'n', 'payload' ), 'answer' );
		ok( M\request_signature( $secret, 'GET', '/x', '1', 'n' ) !== M\request_signature( $secret, 'POST', '/x', '1', 'n' ), 'the method is signed' );
		ok( 1 === preg_match( M\KEY_PATTERN, WPControlAgent\new_secret() ), 'a new agent key matches the format the Manager expects' );
		ok( WPControlAgent\new_secret() !== WPControlAgent\new_secret(), 'every key is new' );
	}
);

test(
	'connection keys are stored encrypted',
	function () {
		$key    = WPControlAgent\new_secret();
		$stored = M\encrypt_secret( $key );
		not_contains( $stored, substr( $key, 5, 20 ), 'stored value' );
		same( $key, M\decrypt_secret( $stored ), 'decrypt' );
		ok( M\encrypt_secret( $key ) !== $stored, 'two encryptions differ' );
		$raw     = base64_decode( substr( $stored, 3 ) );
		$changed = 'v1:' . base64_encode( substr( $raw, 0, -1 ) . chr( ord( substr( $raw, -1 ) ) ^ 1 ) );
		same( '', M\decrypt_secret( $changed ), 'a changed value can not be read' );
		same( '', M\decrypt_secret( 'plain text' ), 'unknown format' );
	}
);

test(
	'website addresses must use https, except a test site on this computer',
	function () {
		same( 'https://www.example.com', M\normalize_site_url( 'https://www.example.com/' ), 'trailing slash' );
		same( 'https://example.com/blog', M\normalize_site_url( ' https://Example.com/blog/ ' ), 'lower-case host, path kept' );
		same( 'http://localhost/wpc-client-a', M\normalize_site_url( 'http://localhost/wpc-client-a/' ), 'local http' );
		same( 'http://shop.test', M\normalize_site_url( 'http://shop.test' ), '.test' );
		$bad = array( 'http://www.example.com', 'http://127.0.0.1.example.com', 'ftp://example.com', 'https://user:pw@example.com', 'https://example.com/?a=1', 'https://example.com/#top', 'example.com', '' );
		foreach ( $bad as $url ) {
			ok( is_wp_error( M\normalize_site_url( $url ) ), "refused: $url" );
		}
	}
);

test(
	'a website is not saved without a complete connection key',
	function () {
		global $wpdb;
		ok( is_wp_error( M\save_site( array( 'url' => 'http://localhost/wpc-client-a' ) ) ), 'no key' );
		ok( is_wp_error( M\save_site( array( 'url' => 'http://localhost/wpc-client-a', 'connection_key' => 'wpc1-abc' ) ) ), 'short key' );
		ok( is_wp_error( M\save_site( array( 'url' => 'http://localhost/wpc-client-a', 'connection_key' => WPControlAgent\new_secret(), 'client_id' => 999 ) ) ), 'unknown client' );
		same( 0, (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . M\table( 'sites' ) ), 'nothing was saved' );
	}
);

test(
	'the agent refuses unsigned, wrongly signed, old and repeated requests, and has no write route',
	function () {
		global $wpc;
		$key          = agent( CLIENT_A, 'create-key' );
		$wpc['key_a'] = $key;

		$unsigned = agent_request( CLIENT_A, $key, array( 'unsigned' => true ) );
		same( 401, $unsigned['code'], 'unsigned' );
		same( 'wpc_unsigned', $unsigned['data']['code'], 'unsigned code' );

		same( 'wpc_bad_signature', agent_request( CLIENT_A, WPControlAgent\new_secret() )['data']['code'], 'another key' );
		same( 'wpc_clock', agent_request( CLIENT_A, $key, array( 'timestamp' => time() - 600 ) )['data']['code'], 'a 10 minute old request' );

		$good = agent_request( CLIENT_A, $key );
		same( 200, $good['code'], 'a correct request' );
		same( M\response_signature( $key, $good['nonce'], $good['data']['payload'] ), $good['data']['signature'], 'the answer is signed' );
		same( 1, json_decode( $good['data']['payload'], true )['schema'], 'payload' );

		same( 'wpc_replay', agent_request( CLIENT_A, $key, array( 'nonce' => $good['nonce'] ) )['data']['code'], 'the same nonce again' );

		$post = agent_request( CLIENT_A, $key, array( 'method' => 'POST' ) );
		same( 404, $post['code'], 'POST' );
		same( 'rest_no_route', $post['data']['code'], 'POST route' );
	}
);

test(
	'adding Client A connects it and reads every plugin, every theme and WordPress',
	function () {
		global $wpdb, $wpc;
		$client = M\save_client(
			array(
				'name'  => 'Studio Alpha d.o.o.',
				'email' => 'info@studio-alpha.test',
			)
		);
		ok( ! is_wp_error( $client ), 'client saved' );
		$id = M\save_site(
			array(
				'name'           => 'studio-alpha.test',
				'url'            => 'http://localhost/wpc-client-a/',
				'client_id'      => $client,
				'connection_key' => $wpc['key_a'],
			)
		);
		ok( ! is_wp_error( $id ), 'site saved' );
		$wpc['site_a']   = $id;
		$wpc['client_a'] = $client;

		same( 0, sync( $id ), 'the first sync is the starting point, so there are no changes' );
		$site = M\get_site_row( $id );
		same( 'online', $site->status, 'status' );
		same( PHP_VERSION, $site->php_version, 'PHP version' );
		same( get_bloginfo( 'version' ), $site->wp_version, 'WordPress version' );

		$counts = json_decode( agent( CLIENT_A, 'counts' ), true );
		same( $counts['plugins'] + $counts['themes'] + 1, count( M\site_components( $id ) ), 'all plugins + all themes + WordPress' );
		same( 0, count_rows( 'component_events', $id ), 'no detected changes yet' );

		$state = json_decode( agent( CLIENT_A, 'state' ), true );
		same( home_url(), $state['manager'], 'the agent knows which dashboard reads it' );
		ok( time() - $state['lastSync'] < 120, 'the agent recorded the sync time' );

		ok( is_wp_error( M\save_site( array( 'url' => 'http://localhost/wpc-client-a', 'connection_key' => $wpc['key_a'] ) ) ), 'the same address can not be added twice' );
		$agent_row = M\get_agent_row( $id );
		not_contains( $agent_row->secret, substr( $wpc['key_a'], 5, 20 ), 'database' );
		same( substr( $wpc['key_a'], -4 ), $agent_row->key_hint, 'only the last 4 characters are kept readable' );
	}
);

test(
	'installs, activations, updates, downgrades, deactivations, theme switches and removals are detected',
	function () {
		global $wpc, $wpdb;
		$id = $wpc['site_a'];

		agent( CLIENT_A, 'test-plugin', '1.0.0', 'WPC Test Plugin & Friends' );
		same( 1, sync( $id ), 'installed' );
		agent( CLIENT_A, 'activate', TEST_PLUGIN );
		same( 1, sync( $id ), 'activated' );
		agent( CLIENT_A, 'test-plugin', '1.1.0', 'WPC Test Plugin & Friends' );
		same( 1, sync( $id ), 'updated' );
		agent( CLIENT_A, 'test-plugin', '1.0.5', 'WPC Test Plugin & Friends' );
		same( 1, sync( $id ), 'downgraded' );
		agent( CLIENT_A, 'deactivate', TEST_PLUGIN );
		same( 1, sync( $id ), 'deactivated' );
		agent( CLIENT_A, 'switch-theme', 'twentytwentyfour' );
		same( 2, sync( $id ), 'theme switch: one theme activated, one deactivated' );
		agent( CLIENT_A, 'remove-test-plugin' );
		same( 1, sync( $id ), 'removed' );
		same( 0, sync( $id ), 'nothing changed' );

		$events = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . M\table( 'component_events' ) . ' WHERE site_id = %d ORDER BY id ASC', $id ) );
		$plugin = array();
		$theme  = array();
		foreach ( $events as $event ) {
			if ( 'theme' === $event->type ) {
				$theme[ $event->slug ] = $event->event;
			} else {
				$plugin[] = $event->event . ' ' . $event->old_value . '>' . $event->new_value;
			}
		}
		ksort( $theme );
		same( array( 'installed >1.0.0', 'activated inactive>active', 'updated 1.0.0>1.1.0', 'downgraded 1.1.0>1.0.5', 'deactivated active>inactive', 'removed 1.0.5>' ), $plugin, 'plugin events' );
		same(
			array(
				'twentytwentyfive' => 'deactivated',
				'twentytwentyfour' => 'activated',
			),
			$theme,
			'theme events'
		);
		same( 'WPC Test Plugin & Friends', $events[0]->name, 'names are saved as plain text' );

		agent( CLIENT_A, 'switch-theme', 'twentytwentyfive' );
		same( 2, sync( $id ), 'theme switched back' );
	}
);

test(
	'update offers are tracked until they are resolved, and unknown stays unknown',
	function () {
		global $wpc;
		$id = $wpc['site_a'];
		agent( CLIENT_A, 'test-plugin', '2.0.0', 'WPC Premium Test' );
		agent( CLIENT_A, 'mu-plugin', 'add' );
		agent( CLIENT_A, 'fake-updates', 'hello.php', '9.9.9', TEST_PLUGIN );
		sync( $id );

		$items = components_by_slug( $id );
		same( 'yes', $items['hello.php']->update_state, 'Hello Dolly has an update' );
		same( '9.9.9', $items['hello.php']->update_version, 'offered version' );
		same( 'unknown', $items[ TEST_PLUGIN ]->update_state, 'a plugin WordPress has no data for' );
		contains( $items[ TEST_PLUGIN ]->update_note, 'Check it manually', 'reason' );
		same( 'unknown', $items['wpc-test-mu.php']->update_state, 'must-use plugin' );
		same( 'must-use', $items['wpc-test-mu.php']->type, 'must-use type' );
		same( 'no', $items['twentytwentyfive']->update_state, 'checked and current theme' );
		same( 'no', $items['wordpress']->update_state, 'WordPress core' );
		same( 'no', $items['wp-control-agent/wp-control-agent.php']->update_state, 'the agent is the newest version' );
		same( 1, (int) M\get_site_row( $id )->pending_updates, 'one pending update' );

		$offers = open_offers( $id );
		same( 1, count( $offers ), 'one open offer' );
		same( '9.9.9', $offers[0]->new_version, 'offer version' );
		sync( $id );
		same( 1, count( open_offers( $id ) ), 'still one offer after the next sync' );

		agent( CLIENT_A, 'fake-updates', 'none', '', TEST_PLUGIN );
		sync( $id );
		same( 0, count( open_offers( $id ) ), 'resolved when WordPress no longer offers it' );
		same( 'no', components_by_slug( $id )['hello.php']->update_state, 'Hello Dolly is current again' );

		$agent = M\agent_update_state( '0.9.0' );
		same( 'yes', $agent[0], 'an older agent is reported as an update' );
	}
);

test(
	'the basic checks describe Client A correctly',
	function () {
		global $wpc;
		$checks = checks_by_key( $wpc['site_a'] );
		same( 'ok', $checks['php']->severity, 'PHP ' . PHP_VERSION . ' is supported' );
		same( 'low', $checks['https']->severity, 'no HTTPS on a local test site' );
		same( 'low', $checks['file_editing']->severity, 'file editor' );
		same( 'moderate', $checks['backup']->severity, 'no backup plugin' );
		same( 'low', $checks['unknown']->severity, 'items that need a manual check' );
		ok( ! isset( $checks['debug'] ), 'errors are not shown to visitors on the test site' );
		same( 0, (int) M\get_site_row( $wpc['site_a'] )->critical_issues, 'no critical issues' );
	}
);

test(
	'serious problems are marked critical and sorted first',
	function () {
		$snapshot   = array(
			'agentVersion' => '0.9.0',
			'site'         => array(
				'php'          => '7.4.33',
				'https'        => false,
				'environment'  => 'production',
				'debugDisplay' => true,
				'fileEditing'  => false,
			),
			'backup'       => array(
				'source'  => 'UpdraftPlus',
				'lastAt'  => time() - 10 * DAY_IN_SECONDS,
				'success' => true,
			),
		);
		$components = array(
			'core|wordpress' => array(
				'type'           => 'core',
				'version'        => '7.0',
				'status'         => 'active',
				'update_state'   => 'yes',
				'update_version' => '7.1',
				'update_note'    => '',
			),
		);
		$settings   = M\default_settings();
		$checks     = M\compute_checks( $snapshot, $components, $settings );
		$by_key     = array();
		foreach ( $checks as $item ) {
			$by_key[ $item['key'] ] = $item['severity'];
		}
		same( 'critical', $by_key['https'], 'a real site without HTTPS' );
		same( 'critical', $by_key['backup'], 'a 10 day old backup' );
		same( 'moderate', $by_key['php'], 'PHP 7.4' );
		same( 'moderate', $by_key['debug'], 'errors shown to visitors' );
		same( 'moderate', $by_key['core'], 'WordPress update' );
		same( 'low', $by_key['agent'], 'old agent' );
		same( 'critical', $checks[0]['severity'], 'critical first' );

		$snapshot['backup']['lastAt'] = time() - 3 * DAY_IN_SECONDS;
		same( 'moderate', M\backup_check( $snapshot['backup'], $settings )['severity'], 'a 3 day old backup' );
		$snapshot['backup']['success'] = false;
		same( 'critical', M\backup_check( $snapshot['backup'], $settings )['severity'], 'a failed backup' );
	}
);

test(
	'UpdraftPlus backups are read with time, size and storage',
	function () {
		global $wpc;
		$wpc['key_b'] = agent( CLIENT_B, 'create-key' );
		agent( CLIENT_B, 'backup-standin', 'add' );
		$older = time() - 3 * DAY_IN_SECONDS;
		$newer = time() - 2 * HOUR_IN_SECONDS;
		agent( CLIENT_B, 'backup-record', $older, '1', 's3' );
		agent( CLIENT_B, 'backup-record', $newer, '1', 'none' );

		$client = M\save_client( array( 'name' => 'Shop Beta' ) );
		$id     = M\save_site(
			array(
				'name'           => 'shop-beta.test',
				'url'            => 'http://localhost/wpc-client-b',
				'client_id'      => $client,
				'connection_key' => $wpc['key_b'],
			)
		);
		ok( ! is_wp_error( $id ), 'site saved' );
		$wpc['site_b'] = $id;
		sync( $id );

		$backups = M\site_backups( $id );
		same( 2, count( $backups ), 'two backups' );
		same( gmdate( 'Y-m-d H:i:s', $newer ), $backups[0]->backup_at, 'newest first' );
		same( 'local', $backups[0]->storage, 'storage of the newest' );
		same( 's3', $backups[1]->storage, 'storage of the older' );
		same( (string) ( 20480 + 1048576 ), $backups[0]->size_bytes, 'size = all parts together' );
		same( 'UpdraftPlus', $backups[0]->source, 'source' );
		same( 'ok', checks_by_key( $id )['backup']->severity, 'recent backup' );
		same( gmdate( 'Y-m-d H:i:s', $newer ), M\get_site_row( $id )->last_backup_at, 'last backup on the site' );

		agent( CLIENT_B, 'backup-record', time() - 60, '0' );
		sync( $id );
		same( 3, count( M\site_backups( $id ) ), 'the failed backup is in the history' );
		same( 'failed', M\site_backups( $id )[0]->status, 'newest is failed' );
		same( 'critical', checks_by_key( $id )['backup']->severity, 'a failed backup is critical' );
		same( gmdate( 'Y-m-d H:i:s', $newer ), M\get_site_row( $id )->last_backup_at, 'the last successful backup is still shown' );
	}
);

test(
	'an answer that is not signed with the key, or that redirects, is refused',
	function () {
		global $wpc;
		$key = WPControlAgent\new_secret();
		fake_agent( 'bad-signature', $key );
		$id = M\save_site(
			array(
				'name'           => 'fake.test',
				'url'            => 'http://localhost/wpc-fake-agent',
				'connection_key' => $key,
			)
		);
		ok( ! is_wp_error( $id ), 'site saved' );
		contains( sync_error( $id ), 'not signed with this connection key', 'bad signature' );
		same( 'error', M\get_site_row( $id )->status, 'status' );

		$headers = (array) json_decode( file_get_contents( 'C:/xampp/htdocs/wpc-fake-agent/headers.txt' ), true );
		$sent    = strtolower( wp_json_encode( $headers ) );
		not_contains( $sent, substr( $key, 5, 20 ), 'the key itself is never sent' );
		contains( $sent, 'x-wpc-signature', 'a signature is sent' );

		fake_agent( 'wrong-format', $key );
		contains( sync_error( $id ), 'unknown format', 'a correctly signed answer with unknown data' );

		fake_agent( 'redirect', $key );
		contains( sync_error( $id ), 'redirected to https://evil.example/steal', 'redirect' );

		same( 0, count( M\site_components( $id ) ), 'nothing from the fake site was saved' );
		M\delete_site( $id );
		remove_fake_agent();
	}
);

test(
	'unreachable sites, wrong keys and missing agents give clear messages and keep the last data',
	function () {
		global $wpc;
		$offline = M\save_site(
			array(
				'name'           => 'offline.test',
				'url'            => 'http://localhost:5999',
				'connection_key' => WPControlAgent\new_secret(),
			)
		);
		contains( sync_error( $offline ), 'could not be reached', 'closed port' );
		same( 'offline', M\get_site_row( $offline )->status, 'offline status' );

		$nowhere = M\save_site(
			array(
				'name'           => 'nowhere.test',
				'url'            => 'http://localhost/wpc-does-not-exist',
				'connection_key' => WPControlAgent\new_secret(),
			)
		);
		contains( sync_error( $nowhere ), 'no WordPress at this address', 'no WordPress' );

		$id     = $wpc['site_b'];
		$client = (int) M\get_site_row( $id )->client_id;
		$before = count( M\site_components( $id ) );
		M\save_site(
			array(
				'name'           => 'shop-beta.test',
				'url'            => 'http://localhost/wpc-client-b',
				'client_id'      => $client,
				'connection_key' => WPControlAgent\new_secret(),
			),
			$id
		);
		contains( sync_error( $id ), 'connection key is wrong', 'wrong key' );
		same( 'error', M\get_site_row( $id )->status, 'error status' );
		same( $before, count( M\site_components( $id ) ), 'the last data is kept' );

		agent( CLIENT_B, 'delete-key' );
		contains( sync_error( $id ), 'has no connection key', 'agent without key' );

		agent( CLIENT_B, 'deactivate', 'wp-control-agent/wp-control-agent.php' );
		contains( sync_error( $id ), 'not installed or not active', 'agent deactivated' );
		agent( CLIENT_B, 'activate', 'wp-control-agent/wp-control-agent.php' );

		$wpc['key_b'] = agent( CLIENT_B, 'create-key' );
		M\save_site(
			array(
				'name'           => 'shop-beta.test',
				'url'            => 'http://localhost/wpc-client-b',
				'client_id'      => $client,
				'connection_key' => $wpc['key_b'],
			),
			$id
		);
		sync( $id );
		same( 'online', M\get_site_row( $id )->status, 'online again with the new key' );
		same( $client, (int) M\get_site_row( $id )->client_id, 'still the same client' );
		same( '', M\get_site_row( $id )->last_error, 'error cleared' );

		$wpc['temporary'] = array( $offline, $nowhere );
	}
);

test(
	'a maintenance record links several detected changes, and wrong input is refused',
	function () {
		global $wpc;
		$id     = $wpc['site_a'];
		$events = M\find_events( array( 'site' => $id ), 50 );
		ok( count( $events ) >= 2, 'there are detected changes' );
		$first  = (int) $events[0]->id;
		$second = (int) $events[1]->id;
		$admin  = get_user_by( 'login', 'admin' )->ID;

		$record = array(
			'site_id'      => $id,
			'performed_at' => current_time( 'Y-m-d\TH:i' ),
			'performer_id' => $admin,
			'category'     => 'update',
			'description'  => "Updated the test plugin\nand checked the shop",
			'duration'     => '25',
			'notes'        => 'Internal note',
			'events'       => array( $first, $second ),
		);
		$log = M\save_log( $record );
		ok( ! is_wp_error( $log ), is_wp_error( $log ) ? $log->get_error_message() : '' );
		$linked = M\linked_event_ids( $log );
		sort( $linked );
		$wanted = array( $first, $second );
		sort( $wanted );
		same( $wanted, $linked, 'both changes are linked' );
		contains( M\get_log( $log )->description, "\n", 'line breaks are kept' );
		same( 25, (int) M\get_log( $log )->duration_minutes, 'duration' );

		$documentation = M\event_documentation( $events );
		same( 'admin', $documentation[ $first ][0]->performer_name, 'the change shows who documented it' );

		$wrong = array(
			'no description' => array( 'description' => '   ' ),
			'future date'    => array( 'performed_at' => wp_date( 'Y-m-d\TH:i', time() + 2 * DAY_IN_SECONDS ) ),
			'bad date'       => array( 'performed_at' => 'yesterday' ),
			'bad duration'   => array( 'duration' => '2h' ),
			'bad category'   => array( 'category' => 'hack' ),
			'no access'      => array( 'performer_id' => test_user( 'subscriber' ) ),
			'other website'  => array( 'site_id' => $wpc['site_b'] ),
		);
		foreach ( $wrong as $label => $change ) {
			ok( is_wp_error( M\save_log( array_merge( $record, $change ) ) ), "refused: $label" );
		}

		ok( ! is_wp_error( M\save_log( array_merge( $record, array( 'events' => array( $first ) ) ), $log ) ), 'edit' );
		same( array( $first ), M\linked_event_ids( $log ), 'links replaced on edit' );

		same( true, M\delete_log( $log ), 'delete' );
		same( array(), M\linked_event_ids( $log ), 'links removed with the record' );
		same( null, M\get_log( $log ), 'record removed' );

		$actions = array();
		foreach ( M\find_audit( $id, 50 ) as $entry ) {
			$actions[] = $entry->action;
		}
		foreach ( array( 'log_created', 'log_updated', 'log_deleted' ) as $action ) {
			ok( in_array( $action, $actions, true ), "audit history has $action" );
		}

		$wpc['log'] = M\save_log( array_merge( $record, array( 'events' => array( $first ) ) ) );
		ok( ! is_wp_error( $wpc['log'] ), 'a record for the next tests' );
	}
);

test(
	'clients are checked, and a client with websites can not be deleted',
	function () {
		global $wpc;
		ok( is_wp_error( M\save_client( array( 'name' => '' ) ) ), 'empty name' );
		ok( is_wp_error( M\save_client( array( 'name' => 'X', 'email' => 'not-an-email' ) ) ), 'bad e-mail' );
		ok( is_wp_error( M\delete_client( $wpc['client_a'] ) ), 'client with a website' );
		$empty = M\save_client( array( 'name' => 'Nobody Yet' ) );
		same( true, M\delete_client( $empty ), 'client without websites' );
		same( null, M\get_client( $empty ), 'deleted' );
	}
);

test(
	'CSV exports contain the data, start with a BOM and never contain a working formula',
	function () {
		global $wpc;
		agent( CLIENT_A, 'test-plugin', '3.0.0', '=HYPERLINK(1+1)' );
		agent( CLIENT_A, 'fake-updates', 'hello.php', '9.9.9', '' );
		sync( $wpc['site_a'] );

		$updates = M\csv_string( M\export_rows( 'updates', array( 'site' => 0, 'month' => '' ) ), ',' );
		contains( $updates, 'Hello Dolly', 'pending updates export' );
		contains( $updates, '9.9.9', 'offered version' );

		foreach ( array_keys( M\EXPORTS ) as $type ) {
			$rows = M\export_rows(
				$type,
				array(
					'site'  => 0,
					'month' => '',
				)
			);
			ok( is_array( $rows ) && count( $rows ) >= 2, "$type has a header and data" );
		}
		ok( is_wp_error( M\export_rows( 'nonsense', array( 'site' => 0, 'month' => '' ) ) ), 'unknown export' );

		$csv = M\csv_string(
			M\export_rows(
				'components',
				array(
					'site'  => $wpc['site_a'],
					'month' => '',
				)
			),
			','
		);
		same( chr( 239 ) . chr( 187 ) . chr( 191 ), substr( $csv, 0, 3 ), 'BOM for Excel' );
		contains( $csv, "'=HYPERLINK(1+1)", 'the formula gets a leading quote' );
		not_contains( $csv, ',=HYPERLINK', 'no cell starts with =' );
		not_contains( $csv, '"=HYPERLINK', 'no quoted cell starts with =' );
		contains( $csv, 'hello.php', 'plugin identifiers' );

		$maintenance = M\csv_string( M\export_rows( 'maintenance', array( 'site' => $wpc['site_a'], 'month' => '' ) ), ';' );
		contains( $maintenance, 'admin', 'performer' );
		contains( $maintenance, 'Internal note', 'notes' );
		same( 'a;"b;c"', trim( substr( M\csv_string( array( array( 'a', 'b;c' ) ), ';' ), 3 ) ), 'semicolon separator' );

		agent( CLIENT_A, 'remove-test-plugin' );
		agent( CLIENT_A, 'mu-plugin', 'remove' );
		agent( CLIENT_A, 'fake-updates', 'none', '' );
		sync( $wpc['site_a'] );
	}
);

test(
	'every screen and every website tab renders without PHP warnings',
	function () {
		global $wpc;
		wp_set_current_user( get_user_by( 'login', 'admin' )->ID );
		foreach ( all_screens() as $label => $html ) {
			contains( $html, 'class="wpc-app"', $label );
		}
		contains( render( array( 'view' => 'overview' ) ), 'studio-alpha.test', 'overview lists the site' );
		contains( render( array( 'view' => 'overview', 'search' => 'beta' ) ), 'shop-beta.test', 'search' );
		not_contains( render( array( 'view' => 'overview', 'search' => 'beta' ) ), 'studio-alpha.test', 'search filters' );
		contains( render( array( 'view' => 'overview', 'status' => 'offline' ) ), 'offline.test', 'status filter' );
		contains( render( array( 'view' => 'overview', 'client' => $wpc['client_a'] ) ), 'studio-alpha.test', 'client filter' );
		contains( render( array( 'view' => 'websites', 'edit' => $wpc['site_a'] ) ), 'Edit website', 'edit website' );
		contains( render( array( 'view' => 'clients', 'edit' => $wpc['client_a'] ) ), 'Edit client', 'edit client' );
		contains( render( array( 'view' => 'maintenance', 'edit' => $wpc['log'] ) ), 'Edit maintenance record', 'edit record' );
		foreach ( array( 'plugins', 'themes', 'core' ) as $filter ) {
			render( array( 'view' => 'overview', 'site' => $wpc['site_a'], 'tab' => 'updates', 'filter' => $filter ) );
		}
		$backups = render( array( 'view' => 'overview', 'site' => $wpc['site_b'], 'tab' => 'backups' ) );
		contains( $backups, 'Last backup failed', 'backups tab' );
		contains( render( array( 'view' => 'overview', 'site' => 999999 ) ), 'Website not found', 'unknown site' );
	}
);

test(
	'names coming from websites are escaped on every screen',
	function () {
		global $wpdb, $wpc;
		$wpdb->update(
			M\table( 'components' ),
			array(
				'name'         => '<img src=x onerror=alert(1)>Evil',
				'update_state' => 'unknown',
			),
			array(
				'site_id' => $wpc['site_a'],
				'slug'    => 'hello.php',
			)
		);
		$wpdb->update( M\table( 'sites' ), array( 'name' => '<script>alert(2)</script>' ), array( 'id' => $wpc['site_a'] ) );

		foreach ( all_screens() as $label => $html ) {
			not_contains( $html, '<img src=x', $label );
			not_contains( $html, '<script>alert(2)', $label );
		}
		contains( render( array( 'view' => 'overview', 'site' => $wpc['site_a'], 'tab' => 'updates' ) ), '&lt;img src=x onerror=alert(1)&gt;Evil', 'shown as text' );

		$wpdb->update( M\table( 'sites' ), array( 'name' => 'studio-alpha.test' ), array( 'id' => $wpc['site_a'] ) );
		sync( $wpc['site_a'] );
		same( 'Hello Dolly', components_by_slug( $wpc['site_a'] )['hello.php']->name, 'the next sync restores the name' );
	}
);

test(
	'only users with the WP Control capability can see or change anything',
	function () {
		wp_set_current_user( test_user( 'editor' ) );
		expect_die(
			function () {
				render( array( 'view' => 'overview' ) );
			},
			'screen'
		);
		foreach ( array_keys( M\ACTIONS ) as $action ) {
			$_REQUEST['_wpnonce'] = wp_create_nonce( $action );
			expect_die(
				function () use ( $action ) {
					M\verify_request( $action );
				},
				$action
			);
		}
		same( false, M\api_allowed(), 'REST' );

		wp_set_current_user( get_user_by( 'login', 'admin' )->ID );
		$_REQUEST = array();
		expect_die(
			function () {
				M\verify_request( 'wpc_delete_site' );
			},
			'administrator without a nonce'
		);
		$_REQUEST['_wpnonce'] = wp_create_nonce( 'wpc_save_site' );
		expect_die(
			function () {
				M\verify_request( 'wpc_delete_site' );
			},
			'a nonce for another action'
		);
		$_REQUEST['_wpnonce'] = wp_create_nonce( 'wpc_delete_site' );
		M\verify_request( 'wpc_delete_site' );
		$_REQUEST = array();

		foreach ( array_keys( M\ACTIONS ) as $action ) {
			ok( false !== has_action( 'admin_post_' . $action ), "$action is registered" );
			ok( false === has_action( 'admin_post_nopriv_' . $action ), "$action is not open to visitors" );
		}
	}
);

test(
	'the REST API answers only users with access, and never shows keys',
	function () {
		global $wpc;
		wp_set_current_user( 0 );
		same( 401, rest_do_request( new WP_REST_Request( 'GET', '/wp-control/v1/sites' ) )->get_status(), 'visitor' );

		wp_set_current_user( get_user_by( 'login', 'admin' )->ID );
		$list = rest_do_request( new WP_REST_Request( 'GET', '/wp-control/v1/sites' ) );
		same( 200, $list->get_status(), 'administrator' );
		ok( count( $list->get_data() ) >= 2, 'sites listed' );

		$one = rest_do_request( new WP_REST_Request( 'GET', '/wp-control/v1/sites/' . $wpc['site_a'] ) );
		same( 200, $one->get_status(), 'one site' );
		ok( count( $one->get_data()['components'] ) > 3, 'with components' );
		same( 404, rest_do_request( new WP_REST_Request( 'GET', '/wp-control/v1/sites/999999' ) )->get_status(), 'unknown site' );
		not_contains( wp_json_encode( array( $list->get_data(), $one->get_data() ) ), 'secret', 'no secret field' );
	}
);

test(
	'settings are checked and change the automatic sync',
	function () {
		$valid = array(
			'frequency'            => 'daily',
			'backup_warning_days'  => '3',
			'backup_critical_days' => '10',
			'min_php'              => '8.3',
			'csv_delimiter'        => ';',
		);
		ok( is_wp_error( M\save_settings( array_merge( $valid, array( 'frequency' => 'weekly' ) ) ) ), 'unknown frequency' );
		ok( is_wp_error( M\save_settings( array_merge( $valid, array( 'backup_critical_days' => '2' ) ) ) ), 'critical before warning' );
		ok( is_wp_error( M\save_settings( array_merge( $valid, array( 'min_php' => 'eight' ) ) ) ), 'PHP version' );
		ok( is_wp_error( M\save_settings( array_merge( $valid, array( 'csv_delimiter' => '|' ) ) ) ), 'separator' );

		same( true, M\save_settings( $valid ), 'valid settings' );
		same( 'daily', wp_get_schedule( M\SYNC_HOOK ), 'daily sync scheduled' );
		same( '8.3', M\settings()['min_php'], 'saved' );
		same( true, M\save_settings( array_merge( $valid, array( 'frequency' => 'manual' ) ) ), 'manual' );
		same( false, wp_next_scheduled( M\SYNC_HOOK ), 'no automatic sync' );
		same( true, M\save_settings( array( 'frequency' => 'hourly', 'backup_warning_days' => '2', 'backup_critical_days' => '7', 'min_php' => '8.2', 'csv_delimiter' => ',' ) ), 'defaults again' );
		same( 'hourly', wp_get_schedule( M\SYNC_HOOK ), 'hourly again' );
	}
);

test(
	'the scheduled sync reads every website, and two syncs never run at the same time',
	function () {
		global $wpdb, $wpc;
		$sites = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . M\table( 'sites' ) );
		$runs  = (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . M\table( 'sync_runs' ) . " WHERE trigger_type = 'schedule'" );
		M\run_scheduled_sync();
		same( $runs + $sites, (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . M\table( 'sync_runs' ) . " WHERE trigger_type = 'schedule'" ), 'one run per website' );
		same( false, get_transient( 'wpc_sync_lock' ), 'the lock is released' );

		$all = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . M\table( 'sync_runs' ) );
		set_transient( 'wpc_sync_lock', time(), 600 );
		M\run_scheduled_sync( 'manual', array( $wpc['site_a'] ) );
		same( $all, (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . M\table( 'sync_runs' ) ), 'nothing runs while another sync is running' );
		ok( false !== wp_next_scheduled( M\SYNC_NOW_HOOK, array( 'manual', array( $wpc['site_a'] ) ) ), 'the manual sync is tried again a minute later' );
		wp_clear_scheduled_hook( M\SYNC_NOW_HOOK, array( 'manual', array( $wpc['site_a'] ) ) );
		delete_transient( 'wpc_sync_lock' );

		M\run_scheduled_sync( 'manual', array( $wpc['site_a'] ) );
		same( $all + 1, (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . M\table( 'sync_runs' ) ), 'a manual sync of one website' );
	}
);

test(
	'deleting a website removes all of its data and nothing else',
	function () {
		global $wpc;
		$keep = count( M\site_components( $wpc['site_a'] ) );
		foreach ( $wpc['temporary'] as $id ) {
			same( true, M\delete_site( $id ), 'deleted' );
			foreach ( array( 'agents', 'components', 'update_offers', 'component_events', 'maintenance_logs', 'site_checks', 'backups', 'sync_runs' ) as $table ) {
				same( 0, count_rows( $table, $id ), "$table of the deleted site" );
			}
			same( null, M\get_site_row( $id ), 'site row' );
		}
		same( $keep, count( M\site_components( $wpc['site_a'] ) ), 'other websites keep their data' );
	}
);

test(
	'the connection keys never appear in the database, on screens, in exports or in the API',
	function () {
		global $wpdb, $wpc;
		$parts = array( substr( $wpc['key_a'], 5, 24 ), substr( $wpc['key_b'], 5, 24 ) );
		$texts = array();
		foreach ( M\TABLES as $name ) {
			$texts[ 'table ' . $name ] = wp_json_encode( $wpdb->get_results( 'SELECT * FROM ' . M\table( $name ), ARRAY_A ) );
		}
		$texts['options'] = implode( "\n", $wpdb->get_col( "SELECT option_value FROM {$wpdb->options}" ) );
		foreach ( all_screens() as $label => $html ) {
			$texts[ 'screen ' . $label ] = $html;
		}
		foreach ( array_keys( M\EXPORTS ) as $type ) {
			$texts[ 'export ' . $type ] = M\csv_string( M\export_rows( $type, array( 'site' => 0, 'month' => '' ) ), ',' );
		}
		$texts['api'] = wp_json_encode( rest_do_request( new WP_REST_Request( 'GET', '/wp-control/v1/sites/' . $wpc['site_a'] ) )->get_data() );
		foreach ( $texts as $label => $text ) {
			foreach ( $parts as $part ) {
				not_contains( $text, $part, $label );
			}
		}
	}
);

test(
	'the Agent page shows the connection, shows a new key only once, and is only for administrators',
	function () {
		global $wpc;
		$status = agent( CLIENT_A, 'render-admin', 'status' );
		contains( $status, 'Connected to the central dashboard', 'status' );
		contains( $status, 'http://localhost/wpc-manager', 'which dashboard' );
		contains( agent( CLIENT_A, 'render-admin', 'updates' ), 'Pending updates', 'updates tab' );

		$first = agent( CLIENT_A, 'render-admin', 'connection', 'admin', 'new-key' );
		contains( $first, $wpc['key_a'], 'the new key is shown' );
		not_contains( agent( CLIENT_A, 'render-admin', 'connection' ), $wpc['key_a'], 'but only once' );

		contains( agent( CLIENT_A, 'render-admin', 'status', 'editor' ), 'DIED:', 'editors can not open it' );
		contains( agent( CLIENT_A, 'post-action', 'create_key' ), 'DIED:', 'a new key needs a nonce' );
		contains( agent( CLIENT_A, 'post-action', 'disconnect' ), 'DIED:', 'disconnect needs a nonce' );
		same( 'yes', agent( CLIENT_A, 'has-key' ), 'the key is still there' );
		sync( $wpc['site_a'] );

		agent( CLIENT_A, 'post-action', 'disconnect', 'with-nonce' );
		same( 'no', agent( CLIENT_A, 'has-key' ), 'disconnected' );
		contains( sync_error( $wpc['site_a'] ), 'has no connection key', 'the dashboard can no longer read the site' );

		agent( CLIENT_A, 'post-action', 'create_key', 'with-nonce' );
		same( 'yes', agent( CLIENT_A, 'has-key' ), 'new key created through the form' );
		agent( CLIENT_A, 'create-key' );
		not_contains( agent( CLIENT_A, 'render-admin', 'connection' ), 'wpc1-', 'a key that was replaced is never shown' );
		agent( CLIENT_A, 'post-action', 'create_key', 'with-nonce' );
		agent( CLIENT_A, 'post-action', 'disconnect', 'with-nonce' );
		not_contains( agent( CLIENT_A, 'render-admin', 'connection' ), 'wpc1-', 'no key is shown after disconnecting' );
	}
);

test(
	'uninstalling removes all data of both plugins, and activating again works',
	function () {
		global $wpdb;
		same( 'clean', agent( CLIENT_B, 'uninstall-agent' ), 'agent options removed' );

		define( 'WP_UNINSTALL_PLUGIN', 'wp-control-manager/wp-control-manager.php' );
		include WP_PLUGIN_DIR . '/wp-control-manager/uninstall.php';
		foreach ( M\TABLES as $name ) {
			same( null, $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', M\table( $name ) ) ), "table $name dropped" );
		}
		same( false, get_option( M\SETTINGS_OPTION ), 'settings removed' );
		ok( ! get_role( 'administrator' )->has_cap( M\CAPABILITY ), 'capability removed' );

		M\activate();
		same( M\table( 'sites' ), $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', M\table( 'sites' ) ) ), 'tables created again' );
		ok( get_role( 'administrator' )->has_cap( M\CAPABILITY ), 'capability again' );
	}
);

function reset_test_sites() {
	global $wpdb;
	foreach ( M\TABLES as $name ) {
		$wpdb->query( 'TRUNCATE TABLE ' . M\table( $name ) );
	}
	update_option( M\SETTINGS_OPTION, M\default_settings(), false );
	delete_transient( 'wpc_sync_lock' );
	wp_clear_scheduled_hook( M\SYNC_NOW_HOOK );
	foreach ( get_users( array( 'search' => 'wpc_test_*' ) ) as $user ) {
		wp_delete_user( $user->ID );
	}
	wp_set_current_user( get_user_by( 'login', 'admin' )->ID );

	foreach ( array( CLIENT_A, CLIENT_B ) as $site ) {
		agent( $site, 'delete-key' );
		agent( $site, 'remove-test-plugin' );
		agent( $site, 'mu-plugin', 'remove' );
		agent( $site, 'backup-standin', 'remove' );
		agent( $site, 'clear-updates' );
		agent( $site, 'switch-theme', 'twentytwentyfive' );
	}
	agent( CLIENT_A, 'fake-updates', 'none', '' );
	agent( CLIENT_B, 'fake-updates', 'none', '' );
	remove_fake_agent();
}

$wpc_started = microtime( true );
echo "Preparing the test sites...\n";
reset_test_sites();

$wpc_passed = 0;
$wpc_failed = 0;
foreach ( $wpc_tests as $wpc_test ) {
	try {
		call_user_func( $wpc_test[1] );
		echo 'ok    ' . $wpc_test[0] . "\n";
		++$wpc_passed;
	} catch ( Throwable $wpc_error ) {
		echo 'FAIL  ' . $wpc_test[0] . "\n      " . $wpc_error->getMessage() . "\n";
		++$wpc_failed;
	}
}

M\schedule_sync();
printf( "\n%d passed, %d failed (%.0f s)\n", $wpc_passed, $wpc_failed, microtime( true ) - $wpc_started );
exit( $wpc_failed > 0 ? 1 : 0 );
