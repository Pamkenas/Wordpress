<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const TABLES = array(
	'clients',
	'sites',
	'agents',
	'components',
	'update_offers',
	'component_events',
	'maintenance_logs',
	'maintenance_event_links',
	'site_checks',
	'backups',
	'sync_runs',
	'audit_log',
);

function table( $name ) {
	global $wpdb;
	return $wpdb->prefix . 'wpc_' . $name;
}

function create_tables() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$charset = $wpdb->get_charset_collate();

	$sql   = array();
	$sql[] = 'CREATE TABLE ' . table( 'clients' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  name varchar(190) NOT NULL DEFAULT '',
  contact_email varchar(190) NOT NULL DEFAULT '',
  notes text NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'sites' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  client_id bigint(20) unsigned NOT NULL DEFAULT 0,
  name varchar(190) NOT NULL DEFAULT '',
  url varchar(255) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'pending',
  wp_version varchar(40) NOT NULL DEFAULT '',
  php_version varchar(40) NOT NULL DEFAULT '',
  active_theme varchar(190) NOT NULL DEFAULT '',
  pending_updates int(11) NOT NULL DEFAULT 0,
  unknown_updates int(11) NOT NULL DEFAULT 0,
  critical_issues int(11) NOT NULL DEFAULT 0,
  last_backup_at datetime NULL DEFAULT NULL,
  last_sync_at datetime NULL DEFAULT NULL,
  last_attempt_at datetime NULL DEFAULT NULL,
  last_error text NULL,
  notes text NULL,
  notes_updated_at datetime NULL DEFAULT NULL,
  notes_updated_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY client_id (client_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'agents' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  secret text NOT NULL,
  key_hint varchar(12) NOT NULL DEFAULT '',
  agent_version varchar(20) NOT NULL DEFAULT '',
  paired_at datetime NOT NULL,
  last_seen_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY site_id (site_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'components' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  type varchar(20) NOT NULL DEFAULT '',
  slug varchar(190) NOT NULL DEFAULT '',
  name varchar(255) NOT NULL DEFAULT '',
  version varchar(60) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT '',
  auto_update tinyint(1) NOT NULL DEFAULT 0,
  update_state varchar(10) NOT NULL DEFAULT 'unknown',
  update_version varchar(60) NOT NULL DEFAULT '',
  update_note varchar(255) NOT NULL DEFAULT '',
  first_seen_at datetime NOT NULL,
  last_seen_at datetime NOT NULL,
  removed_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'update_offers' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  component_id bigint(20) unsigned NOT NULL,
  current_version varchar(60) NOT NULL DEFAULT '',
  new_version varchar(60) NOT NULL DEFAULT '',
  first_seen_at datetime NOT NULL,
  last_seen_at datetime NOT NULL,
  resolved_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id),
  KEY component_id (component_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'component_events' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  component_id bigint(20) unsigned NOT NULL DEFAULT 0,
  sync_run_id bigint(20) unsigned NOT NULL DEFAULT 0,
  type varchar(20) NOT NULL DEFAULT '',
  slug varchar(190) NOT NULL DEFAULT '',
  name varchar(255) NOT NULL DEFAULT '',
  event varchar(20) NOT NULL DEFAULT '',
  old_value varchar(60) NOT NULL DEFAULT '',
  new_value varchar(60) NOT NULL DEFAULT '',
  auto_update tinyint(1) NOT NULL DEFAULT 0,
  detected_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id),
  KEY detected_at (detected_at)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'maintenance_logs' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  performed_at datetime NOT NULL,
  performer_id bigint(20) unsigned NOT NULL DEFAULT 0,
  performer_name varchar(190) NOT NULL DEFAULT '',
  category varchar(40) NOT NULL DEFAULT '',
  description text NOT NULL,
  duration_minutes int(11) NULL DEFAULT NULL,
  notes text NULL,
  created_by bigint(20) unsigned NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id),
  KEY performed_at (performed_at)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'maintenance_event_links' ) . " (
  log_id bigint(20) unsigned NOT NULL,
  event_id bigint(20) unsigned NOT NULL,
  PRIMARY KEY  (log_id,event_id),
  KEY event_id (event_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'site_checks' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  check_key varchar(60) NOT NULL DEFAULT '',
  severity varchar(20) NOT NULL DEFAULT 'ok',
  title varchar(190) NOT NULL DEFAULT '',
  detail varchar(255) NOT NULL DEFAULT '',
  checked_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'backups' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  source varchar(60) NOT NULL DEFAULT '',
  backup_at datetime NOT NULL,
  status varchar(20) NOT NULL DEFAULT '',
  size_bytes bigint(20) unsigned NULL DEFAULT NULL,
  storage varchar(100) NOT NULL DEFAULT '',
  recorded_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY site_backup (site_id,source,backup_at)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'sync_runs' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site_id bigint(20) unsigned NOT NULL,
  trigger_type varchar(20) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT '',
  message text NULL,
  changes int(11) NOT NULL DEFAULT 0,
  started_at datetime NOT NULL,
  finished_at datetime NULL DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id)
) $charset;";

	$sql[] = 'CREATE TABLE ' . table( 'audit_log' ) . " (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  user_name varchar(190) NOT NULL DEFAULT '',
  action varchar(60) NOT NULL DEFAULT '',
  site_id bigint(20) unsigned NOT NULL DEFAULT 0,
  object_type varchar(30) NOT NULL DEFAULT '',
  object_id bigint(20) unsigned NOT NULL DEFAULT 0,
  details text NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY site_id (site_id),
  KEY created_at (created_at)
) $charset;";

	dbDelta( $sql );
}

function activate() {
	create_tables();
	update_option( DB_OPTION, DB_VERSION, false );

	$role = get_role( 'administrator' );
	if ( $role ) {
		$role->add_cap( CAPABILITY );
	}
	if ( false === get_option( SETTINGS_OPTION ) ) {
		add_option( SETTINGS_OPTION, default_settings(), '', false );
	}
	schedule_sync();
}

function deactivate() {
	wp_clear_scheduled_hook( SYNC_HOOK );
	wp_clear_scheduled_hook( SYNC_NOW_HOOK );
}

function maybe_upgrade() {
	if ( DB_VERSION !== get_option( DB_OPTION ) ) {
		create_tables();
		update_option( DB_OPTION, DB_VERSION, false );
	}
}
add_action( 'admin_init', __NAMESPACE__ . '\maybe_upgrade' );

function schedule_sync() {
	wp_clear_scheduled_hook( SYNC_HOOK );
	$frequency = settings()['frequency'];
	if ( 'manual' !== $frequency ) {
		wp_schedule_event( time() + 5 * MINUTE_IN_SECONDS, $frequency, SYNC_HOOK );
	}
}
