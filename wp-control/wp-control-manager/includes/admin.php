<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const VIEWS = array(
	'overview'    => array( 'Overview', 'dashicons-dashboard' ),
	'websites'    => array( 'Websites', 'dashicons-admin-site-alt3' ),
	'clients'     => array( 'Clients', 'dashicons-groups' ),
	'maintenance' => array( 'Maintenance', 'dashicons-hammer' ),
	'activity'    => array( 'Activity', 'dashicons-backup' ),
	'backups'     => array( 'Backups', 'dashicons-database' ),
	'security'    => array( 'Security', 'dashicons-shield' ),
	'reports'     => array( 'Reports', 'dashicons-media-spreadsheet' ),
	'settings'    => array( 'Settings', 'dashicons-admin-generic' ),
);

function add_menu() {
	add_menu_page( 'WP Control', 'WP Control', CAPABILITY, PAGE_SLUG, __NAMESPACE__ . '\render_app', 'dashicons-shield', 3 );
}
add_action( 'admin_menu', __NAMESPACE__ . '\add_menu' );

function enqueue_assets( $hook ) {
	if ( 'toplevel_page_' . PAGE_SLUG !== $hook ) {
		return;
	}
	wp_enqueue_style( 'wp-control-manager', plugins_url( 'assets/admin.css', PLUGIN_FILE ), array( 'dashicons' ), VERSION );
	wp_enqueue_script( 'wp-control-manager', plugins_url( 'assets/admin.js', PLUGIN_FILE ), array(), VERSION, true );
}
add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\enqueue_assets' );

function current_view() {
	$view = sanitize_key( query_arg( 'view' ) );
	return isset( VIEWS[ $view ] ) ? $view : 'overview';
}

function render_sidebar( $current ) {
	echo '<nav class="wpc-sidebar" aria-label="WP Control"><div class="wpc-logo"><span class="dashicons dashicons-shield"></span>WP Control</div><ul>';
	foreach ( VIEWS as $view => $item ) {
		$class = $view === $current ? 'is-active' : '';
		printf(
			'<li><a class="%s" href="%s"><span class="dashicons %s"></span>%s</a></li>',
			esc_attr( $class ),
			esc_url( page_url( array( 'view' => $view ) ) ),
			esc_attr( $item[1] ),
			esc_html( $item[0] )
		);
	}
	echo '</ul></nav>';
}

function render_app() {
	if ( ! current_user_can( CAPABILITY ) ) {
		wp_die( 'You are not allowed to view this page.', 'WP Control', array( 'response' => 403 ) );
	}

	$view    = current_view();
	$site_id = absint( query_arg( 'site' ) );

	echo '<div class="wpc-app">';
	render_sidebar( $view );
	echo '<main class="wpc-main">';
	render_notices();
	call_user_func( __NAMESPACE__ . '\render_' . $view );
	echo '</main>';
	if ( $site_id ) {
		render_site_drawer( $site_id );
	}
	echo '</div>';
}
