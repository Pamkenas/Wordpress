<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;

$wpc_tables = array( 'clients', 'sites', 'agents', 'components', 'update_offers', 'component_events', 'maintenance_logs', 'maintenance_event_links', 'site_checks', 'backups', 'sync_runs', 'audit_log' );
foreach ( $wpc_tables as $wpc_table ) {
	$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'wpc_' . $wpc_table );
}

delete_option( 'wp_control_manager_settings' );
delete_option( 'wp_control_manager_db' );
wp_clear_scheduled_hook( 'wp_control_manager_sync' );
wp_clear_scheduled_hook( 'wp_control_manager_sync_now' );

foreach ( wp_roles()->role_objects as $wpc_role ) {
	$wpc_role->remove_cap( 'manage_wp_control' );
}
