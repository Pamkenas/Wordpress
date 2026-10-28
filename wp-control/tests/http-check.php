<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

$wpc_login = dirname( __DIR__ ) . '/.env';
if ( ! is_file( $wpc_login ) ) {
	fwrite( STDERR, "Run tools/setup-test-sites.php first\n" );
	exit( 1 );
}
$wpc_password = parse_ini_file( $wpc_login, false, INI_SCANNER_RAW )['WPC_TEST_PASSWORD'] ?? '';
$wpc_cookies  = tempnam( sys_get_temp_dir(), 'wpc' );
$wpc_passed   = 0;
$wpc_failed   = 0;

function http( $url, $post = null ) {
	global $wpc_cookies;
	$curl = curl_init( $url );
	curl_setopt_array(
		$curl,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HEADER         => true,
			CURLOPT_COOKIEJAR      => $wpc_cookies,
			CURLOPT_COOKIEFILE     => $wpc_cookies,
			CURLOPT_TIMEOUT        => 90,
			CURLOPT_FOLLOWLOCATION => false,
		)
	);
	if ( null !== $post ) {
		curl_setopt( $curl, CURLOPT_POST, true );
		curl_setopt( $curl, CURLOPT_POSTFIELDS, http_build_query( $post ) );
	}
	$raw  = (string) curl_exec( $curl );
	$size = curl_getinfo( $curl, CURLINFO_HEADER_SIZE );
	$code = curl_getinfo( $curl, CURLINFO_RESPONSE_CODE );
	$headers  = substr( $raw, 0, $size );
	$location = preg_match( '/^Location: (.+)$/mi', $headers, $match ) ? trim( $match[1] ) : '';
	return array(
		'code'     => $code,
		'headers'  => $headers,
		'body'     => substr( $raw, $size ),
		'location' => $location,
	);
}

function check( $condition, $label ) {
	global $wpc_passed, $wpc_failed;
	echo ( $condition ? 'ok    ' : 'FAIL  ' ) . $label . "\n";
	$condition ? ++$wpc_passed : ++$wpc_failed;
}

function form_fields( $html, $action ) {
	$start = strpos( $html, 'name="action" value="' . $action . '"' );
	if ( false === $start ) {
		return array();
	}
	$form = substr( $html, $start, 1500 );
	preg_match( '/name="_wpnonce" value="([a-f0-9]+)"/', $form, $nonce );
	preg_match( '/name="redirect_to" value="([^"]+)"/', $form, $redirect );
	return array(
		'action'      => $action,
		'_wpnonce'    => $nonce[1] ?? '',
		'redirect_to' => html_entity_decode( $redirect[1] ?? '' ),
	);
}

function log_in( $base ) {
	global $wpc_password;
	http( $base . '/wp-login.php' );
	return http(
		$base . '/wp-login.php',
		array(
			'log'         => 'admin',
			'pwd'         => $wpc_password,
			'wp-submit'   => 'Log In',
			'testcookie'  => '1',
			'redirect_to' => $base . '/wp-admin/',
		)
	);
}

$wpc_base = 'http://localhost/wpc-manager';
$wpc_app  = $wpc_base . '/wp-admin/admin.php?page=wp-control';

$wpc_page = http( $wpc_app );
check( 302 === $wpc_page['code'] && false !== strpos( $wpc_page['location'], 'wp-login.php' ), 'a visitor who is not logged in is sent to the login page' );

$wpc_result = log_in( $wpc_base );
check( 302 === $wpc_result['code'], 'the administrator can log in' );

$wpc_page = http( $wpc_app );
check( 200 === $wpc_page['code'] && false !== strpos( $wpc_page['body'], 'class="wpc-app"' ), 'the dashboard opens in wp-admin' );
check( false !== strpos( $wpc_page['body'], 'wp-control-manager/assets/admin.css' ), 'its stylesheet is loaded' );
check( false === strpos( $wpc_page['body'], 'Fatal error' ) && false === strpos( $wpc_page['body'], 'Warning:' ), 'no PHP errors on the page' );

$wpc_clients = http( $wpc_app . '&view=clients' );
$wpc_form    = form_fields( $wpc_clients['body'], 'wpc_save_client' );
check( '' !== $wpc_form['_wpnonce'], 'the form has a nonce' );

$wpc_result = http( $wpc_base . '/wp-admin/admin-post.php', array_merge( $wpc_form, array( 'name' => 'HTTP Test Client' ) ) );
check( 302 === $wpc_result['code'] && 0 === strpos( $wpc_result['location'], $wpc_app ), 'saving a client sends you back to WP Control' );
$wpc_after = http( $wpc_result['location'] );
check( false !== strpos( $wpc_after['body'], 'Client added.' ), 'a success message is shown' );
check( false !== strpos( $wpc_after['body'], 'HTTP Test Client' ), 'the new client is listed' );
check( false === strpos( http( $wpc_result['location'] )['body'], 'Client added.' ), 'the message is shown only once' );

$wpc_result = http( $wpc_base . '/wp-admin/admin-post.php', array_merge( $wpc_form, array( '_wpnonce' => 'wrong', 'name' => 'Forged Client' ) ) );
check( 403 === $wpc_result['code'], 'a form without a valid nonce is refused (HTTP 403)' );
check( false === strpos( http( $wpc_app . '&view=clients' )['body'], 'Forged Client' ), 'and nothing was saved' );

$wpc_result = http( $wpc_base . '/wp-admin/admin-post.php', array_merge( $wpc_form, array( 'name' => 'Evil Redirect', 'redirect_to' => 'https://evil.example/' ) ) );
check( 0 === strpos( $wpc_result['location'], $wpc_app ), 'a redirect to another website is ignored' );

$wpc_reports = http( $wpc_app . '&view=reports' );
$wpc_export  = http(
	$wpc_base . '/wp-admin/admin-post.php',
	array_merge(
		form_fields( $wpc_reports['body'], 'wpc_export' ),
		array(
			'type' => 'websites',
			'site' => '',
		)
	)
);
check( 200 === $wpc_export['code'] && false !== stripos( $wpc_export['headers'], 'Content-Type: text/csv' ), 'the CSV export downloads as a CSV file' );
check( false !== stripos( $wpc_export['headers'], 'attachment; filename="wp-control-websites-' ), 'with a file name' );
check( chr( 239 ) . chr( 187 ) . chr( 191 ) === substr( $wpc_export['body'], 0, 3 ) && false !== strpos( $wpc_export['body'], 'studio-alpha.test' ), 'with a BOM and the websites' );

$wpc_overview = http( $wpc_app );
preg_match( '/name="site_id" value="(\d+)"/', http( $wpc_app . '&view=websites' )['body'], $wpc_site );
$wpc_sync = form_fields( http( $wpc_app . '&view=websites' )['body'], 'wpc_sync_site' );
$wpc_result = http( $wpc_base . '/wp-admin/admin-post.php', array_merge( $wpc_sync, array( 'site_id' => $wpc_site[1] ?? 0 ) ) );
$wpc_after  = http( $wpc_result['location'] );
check( false !== strpos( $wpc_after['body'], 'Synced.' ) || false !== strpos( $wpc_after['body'], 'Sync failed:' ), 'the Sync button works and reports the result' );

foreach ( array( 'Evil Redirect', 'HTTP Test Client' ) as $wpc_name ) {
	$wpc_list = http( $wpc_app . '&view=clients' )['body'];
	if ( preg_match( '/' . preg_quote( $wpc_name, '/' ) . '.{0,2000}?name="id" value="(\d+)"/s', $wpc_list, $wpc_id ) ) {
		$wpc_delete = form_fields( substr( $wpc_list, strpos( $wpc_list, $wpc_name ) ), 'wpc_delete_client' );
		http( $wpc_base . '/wp-admin/admin-post.php', array_merge( $wpc_delete, array( 'id' => $wpc_id[1] ) ) );
	}
}
check( false === strpos( http( $wpc_app . '&view=clients' )['body'], 'HTTP Test Client' ), 'the test clients were deleted again' );

$wpc_rest = http( $wpc_base . '/?rest_route=/wp-control/v1/sites' );
check( 401 === $wpc_rest['code'], 'the REST API refuses a cookie login without the REST nonce' );

unlink( $wpc_cookies );
$wpc_cookies = tempnam( sys_get_temp_dir(), 'wpc' );
log_in( 'http://localhost/wpc-client-a' );
$wpc_agent = http( 'http://localhost/wpc-client-a/wp-admin/admin.php?page=wp-control-agent' );
check( 200 === $wpc_agent['code'] && false !== strpos( $wpc_agent['body'], 'Connected to the central dashboard' ), 'the Agent page on the client site shows the connection' );
$wpc_connection = http( 'http://localhost/wpc-client-a/wp-admin/admin.php?page=wp-control-agent&tab=connection' );
check( false === strpos( $wpc_connection['body'], 'wpc1-' ), 'the Agent page never shows the existing key again' );
foreach ( array( 'update-core.php', 'plugins.php', 'themes.php' ) as $wpc_screen ) {
	check( 200 === http( 'http://localhost/wpc-client-a/wp-admin/' . $wpc_screen )['code'], "the client's wp-admin $wpc_screen still works" );
}

unlink( $wpc_cookies );
printf( "\n%d passed, %d failed\n", $wpc_passed, $wpc_failed );
exit( $wpc_failed > 0 ? 1 : 0 );
