<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

const USERNAME = 'maintenance-auditor';
const APP_NAME = 'Agency maintenance collector (local test)';
const ENV_KEY  = 'WP_LOCAL_APP_PASSWORD';

function stop_with_error( $message ) {
	fwrite( STDERR, $message . "\n" );
	exit( 1 );
}

function copy_folder( $from, $to ) {
	if ( ! is_dir( $to ) && ! mkdir( $to, 0755, true ) ) {
		throw new RuntimeException( "cannot create $to" );
	}
	foreach ( scandir( $from ) as $entry ) {
		if ( '.' === $entry || '..' === $entry ) {
			continue;
		}
		if ( is_dir( "$from/$entry" ) ) {
			copy_folder( "$from/$entry", "$to/$entry" );
		} else {
			copy( "$from/$entry", "$to/$entry" );
		}
	}
}

function save_env_value( $file, $key, $value ) {
	$content = '';
	if ( is_file( $file ) ) {
		$content = file_get_contents( $file );
	}

	$line    = $key . '=' . $value;
	$pattern = '/^' . $key . '=.*$/m';

	if ( preg_match( $pattern, $content ) ) {
		$content = preg_replace( $pattern, $line, $content );
	} elseif ( '' === $content ) {
		$content = $line . "\n";
	} else {
		$content = rtrim( $content, "\r\n" ) . "\n" . $line . "\n";
	}
	file_put_contents( $file, $content );
}

$wp_path  = rtrim( $argv[1] ?? '', '/\\' );
$site_url = $argv[2] ?? 'http://localhost/wordpress';
if ( '' === $wp_path || ! is_file( $wp_path . '/wp-load.php' ) ) {
	stop_with_error( 'Usage: php tools/setup-local-wordpress.php <path-to-wordpress> [site-url]' );
}

$parts = parse_url( $site_url );
$host  = $parts['host'];
if ( isset( $parts['port'] ) ) {
	$host .= ':' . $parts['port'];
}
$_SERVER['HTTP_HOST']   = $host;
$_SERVER['REQUEST_URI'] = $parts['path'] ?? '/';

require $wp_path . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/user.php';

if ( 'local' !== wp_get_environment_type() ) {
	stop_with_error( "Refusing: WP_ENVIRONMENT_TYPE is '" . wp_get_environment_type() . "', not 'local'." );
}

$project = dirname( __DIR__ );
copy_folder( $project . '/wordpress-plugin/agency-maintenance-status', WP_PLUGIN_DIR . '/agency-maintenance-status' );
echo 'Plugin copied to ' . WP_PLUGIN_DIR . "/agency-maintenance-status\n";

$result = activate_plugin( 'agency-maintenance-status/agency-maintenance-status.php' );
if ( is_wp_error( $result ) ) {
	stop_with_error( 'Activation failed: ' . $result->get_error_message() );
}
$role_present = get_role( 'agency_maintenance_auditor' ) ? 'yes' : 'no';
echo "Plugin active, role 'agency_maintenance_auditor' present: $role_present\n";

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
		stop_with_error( 'User creation failed: ' . $user_id->get_error_message() );
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
	stop_with_error( 'Application password failed: ' . $created->get_error_message() );
}

save_env_value( $project . '/.env', ENV_KEY, $created[0] );
echo "Application password '" . APP_NAME . "' created and written to .env as " . ENV_KEY . " (not shown)\n";
