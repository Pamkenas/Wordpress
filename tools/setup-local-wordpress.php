<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

$wp_path  = rtrim( $argv[1] ?? '', '/\\' );
$site_url = $argv[2] ?? 'http://localhost/wordpress';
if ( '' === $wp_path || ! is_file( $wp_path . '/wp-load.php' ) ) {
	fwrite( STDERR, "Usage: php tools/setup-local-wordpress.php <path-to-wordpress> [site-url]\n" );
	exit( 1 );
}

$parts                  = parse_url( $site_url );
$_SERVER['HTTP_HOST']   = $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
$_SERVER['REQUEST_URI'] = $parts['path'] ?? '/';
require $wp_path . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/user.php';

if ( 'local' !== wp_get_environment_type() ) {
	fwrite( STDERR, "Refusing: WP_ENVIRONMENT_TYPE is '" . wp_get_environment_type() . "', not 'local'.\n" );
	exit( 1 );
}

const USERNAME = 'maintenance-auditor';
const APP_NAME = 'Agency maintenance collector (local test)';
const ENV_KEY  = 'WP_LOCAL_APP_PASSWORD';

function copy_dir( $from, $to ) {
	if ( ! is_dir( $to ) && ! mkdir( $to, 0755, true ) ) {
		throw new RuntimeException( "cannot create $to" );
	}
	foreach ( scandir( $from ) as $entry ) {
		if ( '.' === $entry || '..' === $entry ) {
			continue;
		}
		is_dir( "$from/$entry" ) ? copy_dir( "$from/$entry", "$to/$entry" ) : copy( "$from/$entry", "$to/$entry" );
	}
}

$project = dirname( __DIR__ );
copy_dir( $project . '/wordpress-plugin/agency-maintenance-status', WP_PLUGIN_DIR . '/agency-maintenance-status' );
echo "Plugin copied to " . WP_PLUGIN_DIR . "/agency-maintenance-status\n";

$plugin = 'agency-maintenance-status/agency-maintenance-status.php';
$result = activate_plugin( $plugin );
if ( is_wp_error( $result ) ) {
	fwrite( STDERR, 'Activation failed: ' . $result->get_error_message() . "\n" );
	exit( 1 );
}
echo "Plugin active, role 'agency_maintenance_auditor' present: " . ( get_role( 'agency_maintenance_auditor' ) ? 'yes' : 'no' ) . "\n";

$user = get_user_by( 'login', USERNAME );
if ( ! $user ) {
	$user_id = wp_insert_user(
		array(
			'user_login' => USERNAME,
			'user_pass'  => wp_generate_password( 64, true, true ),
			'user_email' => 'maintenance-auditor@example.invalid',
			'role'       => 'agency_maintenance_auditor',
		)
	);
	if ( is_wp_error( $user_id ) ) {
		fwrite( STDERR, 'User creation failed: ' . $user_id->get_error_message() . "\n" );
		exit( 1 );
	}
	$user = get_user_by( 'id', $user_id );
	echo "User '" . USERNAME . "' created (id {$user->ID})\n";
} else {
	$user->set_role( 'agency_maintenance_auditor' );
	echo "User '" . USERNAME . "' exists (id {$user->ID}); role reset to agency_maintenance_auditor only\n";
}

foreach ( WP_Application_Passwords::get_user_application_passwords( $user->ID ) as $item ) {
	if ( APP_NAME === $item['name'] ) {
		WP_Application_Passwords::delete_application_password( $user->ID, $item['uuid'] );
	}
}
$created = WP_Application_Passwords::create_new_application_password( $user->ID, array( 'name' => APP_NAME ) );
if ( is_wp_error( $created ) ) {
	fwrite( STDERR, 'Application password failed: ' . $created->get_error_message() . "\n" );
	exit( 1 );
}

$env_file = $project . '/.env';
$env      = is_file( $env_file ) ? file_get_contents( $env_file ) : '';
$line     = ENV_KEY . '=' . $created[0];
$pattern  = '/^' . ENV_KEY . '=.*$/m';
$env      = preg_match( $pattern, $env ) ? preg_replace( $pattern, $line, $env ) : rtrim( $env, "\r\n" ) . ( '' === $env ? '' : "\n" ) . $line . "\n";
file_put_contents( $env_file, $env );
echo "Application password '" . APP_NAME . "' created and written to .env as " . ENV_KEY . " (not shown)\n";
