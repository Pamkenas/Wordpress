<?php

namespace WPControlAgent;

defined( 'ABSPATH' ) || exit;

function add_menu() {
	add_menu_page( 'WP Control', 'WP Control', 'manage_options', PAGE_SLUG, __NAMESPACE__ . '\render_page', 'dashicons-shield', 80 );
}
add_action( 'admin_menu', __NAMESPACE__ . '\add_menu' );

function page_url( $tab = 'status' ) {
	return add_query_arg(
		array(
			'page' => PAGE_SLUG,
			'tab'  => $tab,
		),
		admin_url( 'admin.php' )
	);
}

function current_tab() {
	$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'status';
	return in_array( $tab, array( 'status', 'updates', 'connection' ), true ) ? $tab : 'status';
}

function new_key_transient() {
	return 'wpc_agent_new_key_' . get_current_user_id();
}

function require_admin( $action ) {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'You are not allowed to do this.', 403 );
	}
	check_admin_referer( $action );
}

function create_key() {
	require_admin( 'wpc_agent_create_key' );
	$secret = new_secret();
	update_option( SECRET_OPTION, $secret, false );
	update_option( CREATED_OPTION, time(), false );
	delete_option( STATE_OPTION );
	delete_option( NONCE_OPTION );
	set_transient( new_key_transient(), $secret, 10 * MINUTE_IN_SECONDS );
	wp_safe_redirect( page_url( 'connection' ) );
	exit;
}
add_action( 'admin_post_wpc_agent_create_key', __NAMESPACE__ . '\create_key' );

function disconnect() {
	require_admin( 'wpc_agent_disconnect' );
	delete_option( SECRET_OPTION );
	delete_option( CREATED_OPTION );
	delete_option( STATE_OPTION );
	delete_option( NONCE_OPTION );
	delete_transient( new_key_transient() );
	wp_safe_redirect( page_url( 'connection' ) );
	exit;
}
add_action( 'admin_post_wpc_agent_disconnect', __NAMESPACE__ . '\disconnect' );

function pending_updates() {
	$list    = array();
	$plugins = get_plugins();
	$cached  = get_site_transient( 'update_plugins' );
	if ( is_object( $cached ) && ! empty( $cached->response ) ) {
		foreach ( (array) $cached->response as $file => $item ) {
			if ( ! isset( $plugins[ $file ] ) ) {
				continue;
			}
			$list[] = array(
				'name'    => text_or( $plugins[ $file ]['Name'], $file ),
				'type'    => 'Plugin',
				'current' => plain_text( $plugins[ $file ]['Version'] ),
				'new'     => (string) offered_version( $item ),
			);
		}
	}

	$cached = get_site_transient( 'update_themes' );
	if ( is_object( $cached ) && ! empty( $cached->response ) ) {
		foreach ( (array) $cached->response as $slug => $item ) {
			$theme = wp_get_theme( $slug );
			if ( ! $theme->exists() ) {
				continue;
			}
			$list[] = array(
				'name'    => text_or( $theme->get( 'Name' ), $slug ),
				'type'    => 'Theme',
				'current' => plain_text( $theme->get( 'Version' ) ),
				'new'     => (string) offered_version( $item ),
			);
		}
	}

	$core = core_info();
	if ( null !== $core['offered'] ) {
		$list[] = array(
			'name'    => 'WordPress',
			'type'    => 'Core',
			'current' => $core['version'],
			'new'     => $core['offered'],
		);
	}
	return $list;
}

function render_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'You are not allowed to view this page.', 403 );
	}
	load_plugin_functions();

	$tab     = current_tab();
	$updates = pending_updates();
	$tabs    = array(
		'status'     => 'Status',
		'updates'    => 'Updates (' . count( $updates ) . ')',
		'connection' => 'Connection',
	);

	echo '<div class="wrap"><h1>WP Control</h1><nav class="nav-tab-wrapper">';
	foreach ( $tabs as $key => $label ) {
		$class = $key === $tab ? 'nav-tab nav-tab-active' : 'nav-tab';
		printf( '<a class="%s" href="%s">%s</a>', esc_attr( $class ), esc_url( page_url( $key ) ), esc_html( $label ) );
	}
	echo '</nav>';

	if ( 'updates' === $tab ) {
		render_updates_tab( $updates );
	} elseif ( 'connection' === $tab ) {
		render_connection_tab();
	} else {
		render_status_tab( $updates );
	}
	echo '</div>';
}

function render_status_tab( $updates ) {
	$state   = get_option( STATE_OPTION, array() );
	$has_key = '' !== (string) get_option( SECRET_OPTION, '' );

	if ( $has_key && ! empty( $state['lastSync'] ) ) {
		echo '<div class="notice notice-success inline"><p><strong>Connected to the central dashboard.</strong> ';
		echo 'Last sync: ' . esc_html( wp_date( 'j M Y, H:i', (int) $state['lastSync'] ) );
		if ( ! empty( $state['manager'] ) ) {
			echo ' from ' . esc_html( $state['manager'] );
		}
		echo '</p></div>';
	} elseif ( $has_key ) {
		echo '<div class="notice notice-warning inline"><p><strong>Waiting for the first sync.</strong> Add this site in WP Control Manager with the connection key.</p></div>';
	} else {
		echo '<div class="notice notice-info inline"><p><strong>Not connected.</strong> Create a connection key on the <a href="' . esc_url( page_url( 'connection' ) ) . '">Connection</a> tab.</p></div>';
	}

	$theme          = wp_get_theme();
	$active_plugins = 0;
	foreach ( array_keys( get_plugins() ) as $file ) {
		if ( is_plugin_active( $file ) ) {
			++$active_plugins;
		}
	}

	$rows = array(
		'Site address'      => home_url(),
		'WordPress version' => wordpress_version(),
		'PHP version'       => PHP_VERSION,
		'Active theme'      => text_or( $theme->get( 'Name' ), $theme->get_stylesheet() ) . ' ' . plain_text( $theme->get( 'Version' ) ),
		'Active plugins'    => (string) $active_plugins,
		'Pending updates'   => (string) count( $updates ),
	);

	echo '<h2>Site information</h2><table class="widefat striped" style="max-width:720px"><tbody>';
	foreach ( $rows as $label => $value ) {
		printf( '<tr><th scope="row">%s</th><td>%s</td></tr>', esc_html( $label ), esc_html( $value ) );
	}
	echo '</tbody></table>';
	echo '<p class="description">This site is managed with WP Control. The agency\'s dashboard can only read this information; it can\'t change anything on the site.</p>';
}

function render_updates_tab( $updates ) {
	echo '<h2>Pending updates</h2>';
	if ( empty( $updates ) ) {
		echo '<p>WordPress knows about no pending updates.</p>';
		return;
	}
	echo '<table class="widefat striped" style="max-width:720px"><thead><tr><th>Name</th><th>Type</th><th>Current</th><th>New</th></tr></thead><tbody>';
	foreach ( $updates as $update ) {
		printf(
			'<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>',
			esc_html( $update['name'] ),
			esc_html( $update['type'] ),
			esc_html( $update['current'] ),
			esc_html( $update['new'] )
		);
	}
	echo '</tbody></table>';
	echo '<p class="description">Updates are installed by a person in Dashboard → Updates. WP Control only reports them.</p>';
}

function render_connection_tab() {
	$new_key = (string) get_transient( new_key_transient() );
	delete_transient( new_key_transient() );
	if ( '' !== $new_key && hash_equals( (string) get_option( SECRET_OPTION, '' ), $new_key ) ) {
		echo '<div class="notice notice-success inline"><p><strong>New connection key created.</strong> Copy it now: it is shown only once.</p></div>';
		echo '<p><label for="wpc-key"><strong>Connection key</strong></label><br>';
		echo '<input id="wpc-key" type="text" class="large-text code" readonly value="' . esc_attr( $new_key ) . '"></p>';
		echo '<p>In WP Control Manager open <strong>Websites → Add website</strong>, enter the site address below and paste this key.</p>';
	}

	$created = (int) get_option( CREATED_OPTION, 0 );
	$has_key = '' !== (string) get_option( SECRET_OPTION, '' );

	echo '<table class="form-table"><tbody>';
	echo '<tr><th scope="row">Site address</th><td><code>' . esc_html( home_url() ) . '</code></td></tr>';
	echo '<tr><th scope="row">Connection key</th><td>';
	if ( $has_key && $created ) {
		echo 'Created on ' . esc_html( wp_date( 'j M Y, H:i', $created ) );
	} elseif ( $has_key ) {
		echo 'Created';
	} else {
		echo 'None yet';
	}
	echo '</td></tr></tbody></table>';

	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
	echo '<input type="hidden" name="action" value="wpc_agent_create_key">';
	wp_nonce_field( 'wpc_agent_create_key' );
	if ( $has_key ) {
		echo '<p>Creating a new key stops the old one at once. Enter the new key in WP Control Manager afterwards.</p>';
		submit_button( 'Create a new key', 'secondary', 'submit', false );
	} else {
		submit_button( 'Create connection key', 'primary', 'submit', false );
	}
	echo '</form>';

	if ( $has_key ) {
		echo '<h2>Disconnect</h2><p>Deletes the key. The dashboard can no longer read this site.</p>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="wpc_agent_disconnect">';
		wp_nonce_field( 'wpc_agent_disconnect' );
		submit_button( 'Disconnect', 'delete', 'submit', false );
		echo '</form>';
	}
}
