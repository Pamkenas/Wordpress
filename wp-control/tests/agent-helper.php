<?php

if ( PHP_SAPI !== 'cli' ) {
	exit( 1 );
}

$wpc_site    = $argv[1] ?? '';
$wpc_command = $argv[2] ?? '';
$wpc_args    = array_slice( $argv, 3 );

if ( ! preg_match( '/^wpc-client-[a-z]$/', $wpc_site ) ) {
	fwrite( STDERR, "Unknown test site\n" );
	exit( 1 );
}

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['SERVER_NAME'] = 'localhost';
$_SERVER['REQUEST_URI'] = '/' . $wpc_site . '/';
require 'C:/xampp/htdocs/' . $wpc_site . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

if ( 'local' !== wp_get_environment_type() ) {
	fwrite( STDERR, "Refusing: not a local site\n" );
	exit( 1 );
}

const TEST_PLUGIN = 'wpc-test-plugin/wpc-test-plugin.php';

function write_test_plugin( $version, $name ) {
	$folder = WP_PLUGIN_DIR . '/wpc-test-plugin';
	if ( ! is_dir( $folder ) ) {
		mkdir( $folder );
	}
	file_put_contents( $folder . '/wpc-test-plugin.php', "<?php\n/**\n * Plugin Name: $name\n * Version: $version\n */\n" );
	wp_clean_plugins_cache( false );
}

function remove_folder( $path ) {
	if ( ! is_dir( $path ) ) {
		return;
	}
	foreach ( scandir( $path ) as $entry ) {
		if ( '.' !== $entry && '..' !== $entry ) {
			is_dir( "$path/$entry" ) ? remove_folder( "$path/$entry" ) : unlink( "$path/$entry" );
		}
	}
	rmdir( $path );
}

function plugin_offer( $file, $version ) {
	$slug = dirname( $file );
	return (object) array(
		'id'           => 'w.org/plugins/' . $slug,
		'slug'         => '.' === $slug ? basename( $file, '.php' ) : $slug,
		'plugin'       => $file,
		'new_version'  => $version,
		'url'          => '',
		'package'      => '',
		'icons'        => array(),
		'banners'      => array(),
		'banners_rtl'  => array(),
		'tested'       => '',
		'requires_php' => '',
	);
}

function fake_updates( $offer_file, $offer_version, $untracked_file ) {
	$plugins = (object) array(
		'last_checked' => time(),
		'checked'      => array(),
		'response'     => array(),
		'no_update'    => array(),
	);
	foreach ( get_plugins() as $file => $data ) {
		$plugins->checked[ $file ] = $data['Version'];
		if ( $file === $offer_file ) {
			$plugins->response[ $file ] = plugin_offer( $file, $offer_version );
		} elseif ( $file !== $untracked_file ) {
			$plugins->no_update[ $file ] = plugin_offer( $file, $data['Version'] );
		}
	}
	set_site_transient( 'update_plugins', $plugins );

	$themes = (object) array(
		'last_checked' => time(),
		'checked'      => array(),
		'response'     => array(),
		'no_update'    => array(),
	);
	foreach ( wp_get_themes() as $slug => $theme ) {
		$themes->checked[ $slug ]   = $theme->get( 'Version' );
		$themes->no_update[ $slug ] = array(
			'theme'        => $slug,
			'new_version'  => $theme->get( 'Version' ),
			'url'          => '',
			'package'      => '',
			'requires'     => '',
			'requires_php' => '',
		);
	}
	set_site_transient( 'update_themes', $themes );

	set_site_transient(
		'update_core',
		(object) array(
			'last_checked'    => time(),
			'version_checked' => get_bloginfo( 'version' ),
			'updates'         => array(
				(object) array(
					'response'        => 'latest',
					'download'        => '',
					'locale'          => get_locale(),
					'packages'        => (object) array(
						'full'        => '',
						'no_content'  => '',
						'new_bundled' => '',
						'partial'     => false,
						'rollback'    => false,
					),
					'current'         => get_bloginfo( 'version' ),
					'version'         => get_bloginfo( 'version' ),
					'php_version'     => '7.4',
					'mysql_version'   => '5.5.5',
					'new_bundled'     => '',
					'partial_version' => false,
				),
			),
		)
	);
}

switch ( $wpc_command ) {
	case 'create-key':
		$wpc_secret = WPControlAgent\new_secret();
		update_option( WPControlAgent\SECRET_OPTION, $wpc_secret, false );
		update_option( WPControlAgent\CREATED_OPTION, time(), false );
		delete_option( WPControlAgent\STATE_OPTION );
		delete_option( WPControlAgent\NONCE_OPTION );
		echo $wpc_secret;
		break;

	case 'delete-key':
		delete_option( WPControlAgent\SECRET_OPTION );
		delete_option( WPControlAgent\CREATED_OPTION );
		delete_option( WPControlAgent\STATE_OPTION );
		delete_option( WPControlAgent\NONCE_OPTION );
		break;

	case 'state':
		echo wp_json_encode( get_option( WPControlAgent\STATE_OPTION, array() ) );
		break;

	case 'counts':
		echo wp_json_encode(
			array(
				'plugins' => count( get_plugins() ) + count( get_mu_plugins() ) + count( get_dropins() ),
				'themes'  => count( wp_get_themes() ),
			)
		);
		break;

	case 'test-plugin':
		write_test_plugin( $wpc_args[0], $wpc_args[1] ?? 'WPC Test Plugin' );
		break;

	case 'remove-test-plugin':
		deactivate_plugins( TEST_PLUGIN, true );
		remove_folder( WP_PLUGIN_DIR . '/wpc-test-plugin' );
		break;

	case 'activate':
		$wpc_result = activate_plugin( $wpc_args[0] );
		if ( is_wp_error( $wpc_result ) ) {
			fwrite( STDERR, $wpc_result->get_error_message() . "\n" );
			exit( 1 );
		}
		break;

	case 'deactivate':
		deactivate_plugins( $wpc_args[0], true );
		break;

	case 'mu-plugin':
		if ( ! is_dir( WPMU_PLUGIN_DIR ) ) {
			mkdir( WPMU_PLUGIN_DIR );
		}
		if ( 'add' === $wpc_args[0] ) {
			file_put_contents( WPMU_PLUGIN_DIR . '/wpc-test-mu.php', "<?php\n/**\n * Plugin Name: WPC Test Must-Use\n * Version: 2.0\n */\n" );
		} elseif ( is_file( WPMU_PLUGIN_DIR . '/wpc-test-mu.php' ) ) {
			unlink( WPMU_PLUGIN_DIR . '/wpc-test-mu.php' );
		}
		break;

	case 'switch-theme':
		switch_theme( $wpc_args[0] );
		break;

	case 'fake-updates':
		fake_updates( $wpc_args[0], $wpc_args[1], $wpc_args[2] ?? '' );
		break;

	case 'clear-updates':
		delete_site_transient( 'update_plugins' );
		delete_site_transient( 'update_themes' );
		delete_site_transient( 'update_core' );
		break;

	case 'backup-standin':
		if ( 'add' === $wpc_args[0] ) {
			if ( ! is_dir( WP_PLUGIN_DIR . '/updraftplus' ) ) {
				mkdir( WP_PLUGIN_DIR . '/updraftplus' );
			}
			file_put_contents( WP_PLUGIN_DIR . '/updraftplus/updraftplus.php', "<?php\n/**\n * Plugin Name: UpdraftPlus test stand-in\n * Version: 1.26.14\n */\n" );
			wp_clean_plugins_cache( false );
			activate_plugin( 'updraftplus/updraftplus.php' );
		} else {
			deactivate_plugins( 'updraftplus/updraftplus.php', true );
			remove_folder( WP_PLUGIN_DIR . '/updraftplus' );
			delete_option( 'updraft_last_backup' );
			delete_option( 'updraft_backup_history' );
		}
		break;

	case 'backup-record':
		$wpc_time    = (int) $wpc_args[0];
		$wpc_success = '1' === $wpc_args[1] ? 1 : 0;
		$wpc_nonce   = substr( md5( (string) $wpc_time ), 0, 12 );
		update_option(
			'updraft_last_backup',
			array(
				'nonincremental_backup_time' => $wpc_time,
				'backup_time'                => $wpc_time,
				'backup_array'               => array( 'db' => 'backup_' . $wpc_nonce . '-db.gz' ),
				'success'                    => $wpc_success,
				'errors'                     => $wpc_success ? array() : array( 'Test error' ),
				'backup_nonce'               => $wpc_nonce,
			)
		);
		if ( $wpc_success ) {
			$wpc_history              = (array) get_option( 'updraft_backup_history', array() );
			$wpc_history[ $wpc_time ] = array(
				'db'           => 'backup_' . $wpc_nonce . '-db.gz',
				'db-size'      => 20480,
				'plugins'      => array( 'backup_' . $wpc_nonce . '-plugins.zip' ),
				'plugins-size' => 1048576,
				'nonce'        => $wpc_nonce,
				'service'      => array( $wpc_args[2] ?? 'none' ),
			);
			update_option( 'updraft_backup_history', $wpc_history, false );
		}
		break;

	case 'has-key':
		echo '' === (string) get_option( WPControlAgent\SECRET_OPTION, '' ) ? 'no' : 'yes';
		break;

	case 'get-secret':
		echo (string) get_option( WPControlAgent\SECRET_OPTION, '' );
		break;

	case 'render-admin':
		require_once ABSPATH . 'wp-admin/includes/template.php';
		add_filter(
			'wp_die_handler',
			function () {
				return function ( $message ) {
					echo 'DIED: ' . ( is_string( $message ) ? $message : 'wp_die' );
					exit( 0 );
				};
			}
		);
		$wpc_role = $wpc_args[1] ?? 'admin';
		$wpc_user = get_user_by( 'login', 'admin' === $wpc_role ? 'admin' : 'wpc_test_' . $wpc_role );
		if ( ! $wpc_user ) {
			$wpc_user = get_user_by(
				'id',
				wp_insert_user(
					array(
						'user_login' => 'wpc_test_' . $wpc_role,
						'user_pass'  => wp_generate_password( 24 ),
						'role'       => $wpc_role,
					)
				)
			);
		}
		wp_set_current_user( $wpc_user->ID );
		$_GET['tab'] = $wpc_args[0];
		if ( 'new-key' === ( $wpc_args[2] ?? '' ) ) {
			set_transient( WPControlAgent\new_key_transient(), get_option( WPControlAgent\SECRET_OPTION ), 600 );
		}
		ob_start();
		WPControlAgent\render_page();
		echo ob_get_clean();
		break;

	case 'post-action':
		add_filter(
			'wp_die_handler',
			function () {
				return function ( $message ) {
					echo 'DIED: ' . ( is_string( $message ) ? $message : 'wp_die' );
					exit( 0 );
				};
			}
		);
		wp_set_current_user( get_user_by( 'login', 'admin' )->ID );
		if ( 'with-nonce' === ( $wpc_args[1] ?? '' ) ) {
			$_REQUEST['_wpnonce'] = wp_create_nonce( 'wpc_agent_' . $wpc_args[0] );
		}
		'create_key' === $wpc_args[0] ? WPControlAgent\create_key() : WPControlAgent\disconnect();
		break;

	case 'uninstall-agent':
		define( 'WP_UNINSTALL_PLUGIN', 'wp-control-agent/wp-control-agent.php' );
		include WP_PLUGIN_DIR . '/wp-control-agent/uninstall.php';
		$wpc_left = array();
		foreach ( array( 'wp_control_agent_secret', 'wp_control_agent_key_created', 'wp_control_agent_state', 'wp_control_agent_nonces' ) as $wpc_option ) {
			if ( false !== get_option( $wpc_option ) ) {
				$wpc_left[] = $wpc_option;
			}
		}
		echo empty( $wpc_left ) ? 'clean' : implode( ',', $wpc_left );
		break;

	default:
		fwrite( STDERR, "Unknown command $wpc_command\n" );
		exit( 1 );
}
