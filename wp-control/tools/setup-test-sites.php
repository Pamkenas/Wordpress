<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

const TEST_SITES = array(
	'wpc-manager'  => array(
		'title'  => 'Agency (WP Control Manager)',
		'plugin' => 'wp-control-manager',
	),
	'wpc-client-a' => array(
		'title'  => 'Client A',
		'plugin' => 'wp-control-agent',
	),
	'wpc-client-b' => array(
		'title'  => 'Client B',
		'plugin' => 'wp-control-agent',
	),
);

const CLIENT_CONFIG = "define( 'DISABLE_WP_CRON', true );\ndefine( 'AUTOMATIC_UPDATER_DISABLED', true );\n";

function stop_with_error( $message ) {
	fwrite( STDERR, $message . "\n" );
	exit( 1 );
}

function copy_folder( $from, $to, $skip = array() ) {
	if ( ! is_dir( $to ) && ! mkdir( $to, 0755, true ) ) {
		stop_with_error( "Cannot create $to" );
	}
	foreach ( scandir( $from ) as $entry ) {
		if ( '.' === $entry || '..' === $entry || in_array( $entry, $skip, true ) ) {
			continue;
		}
		if ( is_dir( "$from/$entry" ) ) {
			copy_folder( "$from/$entry", "$to/$entry" );
		} else {
			copy( "$from/$entry", "$to/$entry" );
		}
	}
}

function delete_folder( $path ) {
	if ( ! is_dir( $path ) ) {
		return;
	}
	foreach ( scandir( $path ) as $entry ) {
		if ( '.' === $entry || '..' === $entry ) {
			continue;
		}
		if ( is_dir( "$path/$entry" ) ) {
			delete_folder( "$path/$entry" );
		} else {
			unlink( "$path/$entry" );
		}
	}
	rmdir( $path );
}

function create_database( $name ) {
	$db = new mysqli( '127.0.0.1', 'root', '' );
	$db->query( "CREATE DATABASE IF NOT EXISTS `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" );
	$db->close();
}

function write_config( $path, $database, $extra ) {
	if ( is_file( "$path/wp-config.php" ) ) {
		return;
	}
	$keys = '';
	foreach ( array( 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT' ) as $key ) {
		$keys .= "define( '$key', '" . bin2hex( random_bytes( 32 ) ) . "' );\n";
	}
	$config = "<?php\n"
		. "define( 'DB_NAME', '$database' );\n"
		. "define( 'DB_USER', 'root' );\n"
		. "define( 'DB_PASSWORD', '' );\n"
		. "define( 'DB_HOST', 'localhost' );\n"
		. "define( 'DB_CHARSET', 'utf8mb4' );\n"
		. "define( 'DB_COLLATE', '' );\n"
		. $keys
		. "\$table_prefix = 'wp_';\n"
		. $extra
		. "define( 'WP_ENVIRONMENT_TYPE', 'local' );\n"
		. "define( 'WP_DEBUG', true );\n"
		. "define( 'WP_DEBUG_LOG', true );\n"
		. "define( 'WP_DEBUG_DISPLAY', false );\n"
		. "if ( ! defined( 'ABSPATH' ) ) {\n\tdefine( 'ABSPATH', __DIR__ . '/' );\n}\n"
		. "require_once ABSPATH . 'wp-settings.php';\n";
	file_put_contents( "$path/wp-config.php", $config );
}

function load_wordpress( $path, $url ) {
	$parts                  = parse_url( $url );
	$_SERVER['HTTP_HOST']   = $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
	$_SERVER['REQUEST_URI'] = $parts['path'] ?? '/';
	$_SERVER['SERVER_NAME'] = $parts['host'];

	$GLOBALS['wp_filter'] = array(
		'pre_wp_mail' => array(
			10 => array(
				array(
					'function'      => '__return_true',
					'accepted_args' => 1,
				),
			),
		),
	);
	define( 'WP_INSTALLING', true );
	require $path . '/wp-load.php';
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
}

function install_site( $path, $url, $title, $plugin, $password ) {
	load_wordpress( $path, $url );

	if ( ! is_blog_installed() ) {
		wp_install( $title, 'admin', 'admin@example.test', false, '', $password );
		update_option( 'timezone_string', 'Europe/Ljubljana' );
		echo "  WordPress installed\n";
	} else {
		echo "  WordPress already installed\n";
	}

	$file   = $plugin . '/' . $plugin . '.php';
	$result = activate_plugin( $file );
	if ( is_wp_error( $result ) ) {
		stop_with_error( '  Activation failed: ' . $result->get_error_message() );
	}
	echo "  $file active\n";
}

if ( isset( $argv[1] ) && 'install' === $argv[1] ) {
	install_site( $argv[2], $argv[3], $argv[4], $argv[5], $argv[6] );
	exit( 0 );
}

$source  = rtrim( str_replace( '\\', '/', $argv[1] ?? 'C:/xampp/htdocs/wordpress' ), '/' );
$project = str_replace( '\\', '/', dirname( __DIR__ ) );
$htdocs  = dirname( $source );
if ( ! is_file( "$source/wp-includes/version.php" ) ) {
	stop_with_error( 'Usage: php tools/setup-test-sites.php [path to an existing WordPress, default C:/xampp/htdocs/wordpress]' );
}

$login_file = "$project/.env";
$login      = is_file( $login_file ) ? parse_ini_file( $login_file, false, INI_SCANNER_RAW ) : array();
$password   = $login['WPC_TEST_PASSWORD'] ?? bin2hex( random_bytes( 8 ) );

foreach ( TEST_SITES as $folder => $site ) {
	$path = "$htdocs/$folder";
	$url  = "http://localhost/$folder";
	echo "$folder ($url)\n";

	copy_folder( $source, $path, array( 'wp-config.php', 'wp-content', '.htaccess', '.maintenance' ) );
	if ( ! is_dir( "$path/wp-content" ) ) {
		mkdir( "$path/wp-content/plugins", 0755, true );
		copy_folder( "$source/wp-content/themes", "$path/wp-content/themes" );
		copy( "$source/wp-content/plugins/hello.php", "$path/wp-content/plugins/hello.php" );
		file_put_contents( "$path/wp-content/index.php", "<?php\n" );
	}

	$plugin_target = "$path/wp-content/plugins/{$site['plugin']}";
	delete_folder( $plugin_target );
	copy_folder( "$project/{$site['plugin']}", $plugin_target );
	echo "  {$site['plugin']} copied\n";

	create_database( str_replace( '-', '_', $folder ) );
	write_config( $path, str_replace( '-', '_', $folder ), 'wp-control-agent' === $site['plugin'] ? CLIENT_CONFIG : '' );

	$command = escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __FILE__ ) . ' install ' . escapeshellarg( $path ) . ' ' . escapeshellarg( $url ) . ' ' . escapeshellarg( $site['title'] ) . ' ' . escapeshellarg( $site['plugin'] ) . ' ' . escapeshellarg( $password );
	passthru( $command, $code );
	if ( 0 !== $code ) {
		stop_with_error( "Setup of $folder failed." );
	}
}

file_put_contents( $login_file, "WPC_TEST_USER=admin\nWPC_TEST_PASSWORD=$password\n" );
echo "\nDone. The login for all three sites is in $login_file\n";
