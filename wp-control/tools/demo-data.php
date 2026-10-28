<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

define( 'DISABLE_WP_CRON', true );
$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['SERVER_NAME'] = 'localhost';
$_SERVER['REQUEST_URI'] = '/wpc-manager/wp-admin/admin.php';
require 'C:/xampp/htdocs/wpc-manager/wp-load.php';

use WPControlManager as M;

if ( 'http://localhost/wpc-manager' !== home_url() || 'local' !== wp_get_environment_type() ) {
	fwrite( STDERR, "Refusing: demo data is only for the local test site http://localhost/wpc-manager\n" );
	exit( 1 );
}

function agent( $site, ...$args ) {
	$command = escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( dirname( __DIR__ ) . '/tests/agent-helper.php' ) . ' ' . escapeshellarg( $site );
	foreach ( $args as $arg ) {
		$command .= ' ' . escapeshellarg( (string) $arg );
	}
	exec( $command . ' 2>&1', $output, $code );
	if ( 0 !== $code ) {
		fwrite( STDERR, implode( "\n", $output ) . "\n" );
		exit( 1 );
	}
	return implode( "\n", $output );
}

function sync_now( $site_id ) {
	$result = M\sync_site( $site_id, 'manual' );
	echo is_wp_error( $result ) ? '  sync: ' . $result->get_error_message() . "\n" : "  sync: ok, $result changes\n";
}

global $wpdb;
foreach ( M\TABLES as $name ) {
	$wpdb->query( 'TRUNCATE TABLE ' . M\table( $name ) );
}
wp_set_current_user( get_user_by( 'login', 'admin' )->ID );

echo "Client A (studio-alpha.test)\n";
agent( 'wpc-client-a', 'remove-test-plugin' );
agent( 'wpc-client-a', 'switch-theme', 'twentytwentyfive' );
agent( 'wpc-client-a', 'test-plugin', '3.31.0', 'Elementor Pro (demo)' );
agent( 'wpc-client-a', 'activate', 'wpc-test-plugin/wpc-test-plugin.php' );
agent( 'wpc-client-a', 'fake-updates', 'none', '', 'wpc-test-plugin/wpc-test-plugin.php' );
$alpha_client = M\save_client(
	array(
		'name'  => 'Studio Alpha',
		'email' => 'info@studio-alpha.test',
	)
);
$alpha        = M\save_site(
	array(
		'name'           => 'studio-alpha.test',
		'url'            => 'http://localhost/wpc-client-a',
		'client_id'      => $alpha_client,
		'connection_key' => agent( 'wpc-client-a', 'create-key' ),
	)
);
sync_now( $alpha );
agent( 'wpc-client-a', 'test-plugin', '3.32.1', 'Elementor Pro (demo)' );
agent( 'wpc-client-a', 'fake-updates', 'hello.php', '1.7.3', 'wpc-test-plugin/wpc-test-plugin.php' );
sync_now( $alpha );

echo "Client B (shop-beta.test)\n";
agent( 'wpc-client-b', 'backup-standin', 'remove' );
agent( 'wpc-client-b', 'backup-standin', 'add' );
agent( 'wpc-client-b', 'backup-record', time() - 26 * HOUR_IN_SECONDS, '1', 's3' );
agent( 'wpc-client-b', 'backup-record', time() - 2 * HOUR_IN_SECONDS, '1', 's3' );
agent( 'wpc-client-b', 'fake-updates', 'none', '' );
$beta_client = M\save_client( array( 'name' => 'Shop Beta' ) );
$beta        = M\save_site(
	array(
		'name'           => 'shop-beta.test',
		'url'            => 'http://localhost/wpc-client-b',
		'client_id'      => $beta_client,
		'connection_key' => agent( 'wpc-client-b', 'create-key' ),
	)
);
sync_now( $beta );

echo "An offline website (portfolio-gamma.test)\n";
$gamma_client = M\save_client( array( 'name' => 'Gamma d.o.o.' ) );
$gamma        = M\save_site(
	array(
		'name'           => 'portfolio-gamma.test',
		'url'            => 'http://localhost:5999',
		'client_id'      => $gamma_client,
		'connection_key' => 'wpc1-' . str_repeat( '0', 64 ),
	)
);
sync_now( $gamma );

$events = M\find_events( array( 'site' => $alpha ), 5 );
M\save_log(
	array(
		'site_id'      => $alpha,
		'performed_at' => current_time( 'Y-m-d\TH:i' ),
		'performer_id' => get_current_user_id(),
		'category'     => 'update',
		'description'  => 'Updated Elementor Pro and checked the contact form.',
		'duration'     => '20',
		'notes'        => 'Demo record',
		'events'       => array( (int) $events[0]->id ),
	)
);
M\save_notes( $alpha, 'Demo notes: the client prefers updates on Tuesday mornings.' );

echo "\nDone. Open http://localhost/wpc-manager/wp-admin/admin.php?page=wp-control\n";
