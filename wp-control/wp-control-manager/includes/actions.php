<?php

namespace WPControlManager;

use WP_Error;

defined( 'ABSPATH' ) || exit;

const ACTIONS = array(
	'wpc_save_client'   => 'handle_save_client',
	'wpc_delete_client' => 'handle_delete_client',
	'wpc_save_site'     => 'handle_save_site',
	'wpc_delete_site'   => 'handle_delete_site',
	'wpc_sync_site'     => 'handle_sync_site',
	'wpc_sync_selected' => 'handle_sync_selected',
	'wpc_sync_all'      => 'handle_sync_all',
	'wpc_save_log'      => 'handle_save_log',
	'wpc_delete_log'    => 'handle_delete_log',
	'wpc_save_notes'    => 'handle_save_notes',
	'wpc_save_settings' => 'handle_save_settings',
	'wpc_export'        => 'handle_export',
);

foreach ( ACTIONS as $wpc_action => $wpc_handler ) {
	add_action( 'admin_post_' . $wpc_action, __NAMESPACE__ . '\\' . $wpc_handler );
}

function verify_request( $action ) {
	if ( ! current_user_can( CAPABILITY ) ) {
		wp_die( 'You are not allowed to do this.', 'WP Control', array( 'response' => 403 ) );
	}
	check_admin_referer( $action );
}

function go_back( $fallback = array() ) {
	$target = isset( $_POST['redirect_to'] ) ? esc_url_raw( wp_unslash( $_POST['redirect_to'] ) ) : '';
	if ( 0 !== strpos( $target, page_url() ) ) {
		$target = page_url( $fallback );
	}
	wp_safe_redirect( $target );
	exit;
}

function report( $result, $success ) {
	if ( is_wp_error( $result ) ) {
		add_notice( 'error', $result->get_error_message() );
	} else {
		add_notice( 'success', $success );
	}
}

function report_sync( $result ) {
	if ( is_wp_error( $result ) ) {
		add_notice( 'error', 'Sync failed: ' . $result->get_error_message() );
	} elseif ( $result > 0 ) {
		add_notice( 'success', 'Synced. ' . plural( $result, 'change', 'changes' ) . ' detected.' );
	} else {
		add_notice( 'success', 'Synced. No changes.' );
	}
}

function save_client( $data, $id = 0 ) {
	global $wpdb;
	$name  = clean_text( sanitize_text_field( $data['name'] ?? '' ), 190 );
	$email = sanitize_email( $data['email'] ?? '' );
	if ( '' === $name ) {
		return new WP_Error( 'wpc_client', 'Enter the client name.' );
	}
	if ( '' !== trim( (string) ( $data['email'] ?? '' ) ) && ! is_email( $email ) ) {
		return new WP_Error( 'wpc_client', 'The e-mail address is not valid.' );
	}

	$fields = array(
		'name'          => $name,
		'contact_email' => $email,
		'notes'         => clean_textarea( $data['notes'] ?? '', 5000 ),
	);
	if ( $id ) {
		if ( ! get_client( $id ) ) {
			return new WP_Error( 'wpc_client', 'The client was not found.' );
		}
		$wpdb->update( table( 'clients' ), $fields, array( 'id' => $id ) );
		audit( 'client_updated', 'client', $id, 0, $name );
		return $id;
	}

	$fields['created_at'] = now();
	$wpdb->insert( table( 'clients' ), $fields );
	$id = (int) $wpdb->insert_id;
	audit( 'client_created', 'client', $id, 0, $name );
	return $id;
}

function delete_client( $id ) {
	global $wpdb;
	$client = get_client( $id );
	if ( ! $client ) {
		return new WP_Error( 'wpc_client', 'The client was not found.' );
	}
	$sites = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . table( 'sites' ) . ' WHERE client_id = %d', $id ) );
	if ( $sites > 0 ) {
		return new WP_Error( 'wpc_client', 'This client still has websites. Move or delete them first.' );
	}
	$wpdb->delete( table( 'clients' ), array( 'id' => $id ) );
	audit( 'client_deleted', 'client', $id, 0, $client->name );
	return true;
}

function save_agent_key( $site_id, $key ) {
	global $wpdb;
	$fields = array(
		'secret'    => encrypt_secret( $key ),
		'key_hint'  => substr( $key, -4 ),
		'paired_at' => now(),
	);
	if ( get_agent_row( $site_id ) ) {
		$wpdb->update( table( 'agents' ), $fields, array( 'site_id' => $site_id ) );
		return;
	}
	$fields['site_id'] = $site_id;
	$wpdb->insert( table( 'agents' ), $fields );
}

function save_site( $data, $id = 0 ) {
	global $wpdb;
	$url = normalize_site_url( $data['url'] ?? '' );
	if ( is_wp_error( $url ) ) {
		return $url;
	}

	$name      = clean_text( sanitize_text_field( $data['name'] ?? '' ), 190 );
	$client_id = absint( $data['client_id'] ?? 0 );
	$key       = trim( (string) ( $data['connection_key'] ?? '' ) );
	if ( '' === $name ) {
		$name = clean_text( (string) wp_parse_url( $url, PHP_URL_HOST ), 190 );
	}
	if ( $client_id && ! get_client( $client_id ) ) {
		return new WP_Error( 'wpc_site', 'Choose a client from the list.' );
	}
	if ( '' !== $key && ! preg_match( KEY_PATTERN, $key ) ) {
		return new WP_Error( 'wpc_site', 'The connection key is not complete. Copy the whole key; it starts with wpc1-.' );
	}
	if ( ! $id && '' === $key ) {
		return new WP_Error( 'wpc_site', 'Enter the connection key. It is on the client site under WP Control → Connection.' );
	}
	if ( $id && ! get_site_row( $id ) ) {
		return new WP_Error( 'wpc_site', 'The website was not found.' );
	}

	$duplicate = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . table( 'sites' ) . ' WHERE url = %s AND id <> %d', $url, $id ) );
	if ( $duplicate ) {
		return new WP_Error( 'wpc_site', 'This website is already in the list.' );
	}

	$fields = array(
		'client_id' => $client_id,
		'name'      => $name,
		'url'       => $url,
	);
	if ( $id ) {
		$wpdb->update( table( 'sites' ), $fields, array( 'id' => $id ) );
		audit( 'site_updated', 'site', $id, $id, $name . ' (' . $url . ')' );
	} else {
		$fields['status']     = 'pending';
		$fields['last_error'] = '';
		$fields['notes']      = '';
		$fields['created_at'] = now();
		$wpdb->insert( table( 'sites' ), $fields );
		$id = (int) $wpdb->insert_id;
		audit( 'site_created', 'site', $id, $id, $name . ' (' . $url . ')' );
	}

	if ( '' !== $key ) {
		save_agent_key( $id, $key );
		audit( 'key_saved', 'site', $id, $id, 'Connection key ending in ' . substr( $key, -4 ) );
	}
	return $id;
}

function delete_site( $id ) {
	global $wpdb;
	$site = get_site_row( $id );
	if ( ! $site ) {
		return new WP_Error( 'wpc_site', 'The website was not found.' );
	}

	$wpdb->query(
		$wpdb->prepare(
			'DELETE l FROM ' . table( 'maintenance_event_links' ) . ' l JOIN ' . table( 'maintenance_logs' ) . ' m ON m.id = l.log_id WHERE m.site_id = %d',
			$id
		)
	);
	foreach ( array( 'agents', 'components', 'update_offers', 'component_events', 'maintenance_logs', 'site_checks', 'backups', 'sync_runs' ) as $name ) {
		$wpdb->delete( table( $name ), array( 'site_id' => $id ) );
	}
	$wpdb->delete( table( 'sites' ), array( 'id' => $id ) );
	audit( 'site_deleted', 'site', $id, $id, $site->name . ' (' . $site->url . ')' );
	return true;
}

function save_log( $data, $id = 0 ) {
	global $wpdb;
	$site_id = absint( $data['site_id'] ?? 0 );
	if ( ! get_site_row( $site_id ) ) {
		return new WP_Error( 'wpc_log', 'Choose a website.' );
	}

	$performed_at = parse_local_datetime( $data['performed_at'] ?? '' );
	if ( '' === $performed_at ) {
		return new WP_Error( 'wpc_log', 'Enter the date and time of the work.' );
	}
	if ( timestamp_from_gmt( $performed_at ) > time() + HOUR_IN_SECONDS ) {
		return new WP_Error( 'wpc_log', 'The date of the work is in the future.' );
	}

	$performer = get_userdata( absint( $data['performer_id'] ?? 0 ) );
	if ( ! $performer || ! user_can( $performer, CAPABILITY ) ) {
		return new WP_Error( 'wpc_log', 'Choose who did the work.' );
	}

	$category = sanitize_key( $data['category'] ?? '' );
	if ( ! isset( CATEGORIES[ $category ] ) ) {
		return new WP_Error( 'wpc_log', 'Choose a work category.' );
	}

	$description = clean_textarea( $data['description'] ?? '', 2000 );
	if ( '' === $description ) {
		return new WP_Error( 'wpc_log', 'Describe the work.' );
	}

	$duration      = null;
	$duration_text = trim( (string) ( $data['duration'] ?? '' ) );
	if ( '' !== $duration_text ) {
		if ( ! ctype_digit( $duration_text ) || (int) $duration_text < 1 || (int) $duration_text > 10000 ) {
			return new WP_Error( 'wpc_log', 'The duration must be a whole number of minutes.' );
		}
		$duration = (int) $duration_text;
	}

	$wanted = array_unique( array_filter( array_map( 'absint', (array) ( $data['events'] ?? array() ) ) ) );
	$events = get_events_by_ids( $site_id, $wanted );
	if ( count( $events ) !== count( $wanted ) ) {
		return new WP_Error( 'wpc_log', 'Some of the selected changes do not belong to this website.' );
	}

	$fields = array(
		'site_id'          => $site_id,
		'performed_at'     => $performed_at,
		'performer_id'     => (int) $performer->ID,
		'performer_name'   => clean_text( $performer->display_name, 190 ),
		'category'         => $category,
		'description'      => $description,
		'duration_minutes' => $duration,
		'notes'            => clean_textarea( $data['notes'] ?? '', 5000 ),
	);
	$summary = CATEGORIES[ $category ] . ': ' . mb_substr( $description, 0, 80 );

	if ( $id ) {
		$log = get_log( $id );
		if ( ! $log ) {
			return new WP_Error( 'wpc_log', 'The maintenance record was not found.' );
		}
		$fields['updated_at'] = now();
		$wpdb->update( table( 'maintenance_logs' ), $fields, array( 'id' => $id ) );
		$wpdb->delete( table( 'maintenance_event_links' ), array( 'log_id' => $id ) );
		audit( 'log_updated', 'maintenance', $id, $site_id, $summary );
	} else {
		$fields['created_by'] = get_current_user_id();
		$fields['created_at'] = now();
		$wpdb->insert( table( 'maintenance_logs' ), $fields );
		$id = (int) $wpdb->insert_id;
		audit( 'log_created', 'maintenance', $id, $site_id, $summary );
	}

	foreach ( $events as $event ) {
		$wpdb->insert(
			table( 'maintenance_event_links' ),
			array(
				'log_id'   => $id,
				'event_id' => (int) $event->id,
			)
		);
	}
	return $id;
}

function delete_log( $id ) {
	global $wpdb;
	$log = get_log( $id );
	if ( ! $log ) {
		return new WP_Error( 'wpc_log', 'The maintenance record was not found.' );
	}
	$wpdb->delete( table( 'maintenance_event_links' ), array( 'log_id' => $id ) );
	$wpdb->delete( table( 'maintenance_logs' ), array( 'id' => $id ) );
	audit( 'log_deleted', 'maintenance', $id, (int) $log->site_id, mb_substr( $log->description, 0, 80 ) );
	return true;
}

function save_notes( $site_id, $notes ) {
	global $wpdb;
	if ( ! get_site_row( $site_id ) ) {
		return new WP_Error( 'wpc_notes', 'The website was not found.' );
	}
	$wpdb->update(
		table( 'sites' ),
		array(
			'notes'            => clean_textarea( $notes, 10000 ),
			'notes_updated_at' => now(),
			'notes_updated_by' => get_current_user_id(),
		),
		array( 'id' => $site_id )
	);
	audit( 'notes_updated', 'site', $site_id, $site_id, 'Notes changed' );
	return true;
}

function save_settings( $data ) {
	$frequency = sanitize_key( $data['frequency'] ?? '' );
	$warning   = absint( $data['backup_warning_days'] ?? 0 );
	$critical  = absint( $data['backup_critical_days'] ?? 0 );
	$min_php   = trim( (string) ( $data['min_php'] ?? '' ) );
	$delimiter = (string) ( $data['csv_delimiter'] ?? '' );

	if ( ! isset( FREQUENCIES[ $frequency ] ) ) {
		return new WP_Error( 'wpc_settings', 'Choose how often to sync.' );
	}
	if ( $warning < 1 || $warning > 90 || $critical <= $warning || $critical > 365 ) {
		return new WP_Error( 'wpc_settings', 'Backup days: the warning must be 1–90 days, and the critical limit must be larger.' );
	}
	if ( ! preg_match( '/^\d+\.\d+$/', $min_php ) ) {
		return new WP_Error( 'wpc_settings', 'The minimum PHP version must look like 8.2.' );
	}
	if ( ',' !== $delimiter && ';' !== $delimiter ) {
		return new WP_Error( 'wpc_settings', 'Choose a CSV separator.' );
	}

	update_option(
		SETTINGS_OPTION,
		array(
			'frequency'            => $frequency,
			'backup_warning_days'  => $warning,
			'backup_critical_days' => $critical,
			'min_php'              => $min_php,
			'csv_delimiter'        => $delimiter,
		),
		false
	);
	schedule_sync();
	audit( 'settings_saved', 'settings', 0, 0, 'Sync: ' . FREQUENCIES[ $frequency ] . ', backups ' . $warning . '/' . $critical . ' days, PHP ' . $min_php );
	return true;
}

function queue_sync( $ids ) {
	wp_schedule_single_event( time(), SYNC_NOW_HOOK, array( 'manual', array_values( $ids ) ) );
	spawn_cron();
}

function handle_save_client() {
	verify_request( 'wpc_save_client' );
	$data   = wp_unslash( $_POST );
	$id     = absint( $data['id'] ?? 0 );
	$result = save_client( $data, $id );
	report( $result, $id ? 'Client saved.' : 'Client added.' );
	go_back( array( 'view' => 'clients' ) );
}

function handle_delete_client() {
	verify_request( 'wpc_delete_client' );
	report( delete_client( absint( $_POST['id'] ?? 0 ) ), 'Client deleted.' );
	go_back( array( 'view' => 'clients' ) );
}

function handle_save_site() {
	verify_request( 'wpc_save_site' );
	$data   = wp_unslash( $_POST );
	$id     = absint( $data['id'] ?? 0 );
	$key    = trim( (string) ( $data['connection_key'] ?? '' ) );
	$result = save_site( $data, $id );

	if ( is_wp_error( $result ) ) {
		remember_input(
			'site',
			array(
				'id'             => $id,
				'name'           => clean_text( sanitize_text_field( $data['name'] ?? '' ), 190 ),
				'url'            => clean_text( sanitize_text_field( $data['url'] ?? '' ), 255 ),
				'client_id'      => absint( $data['client_id'] ?? 0 ),
				'connection_key' => preg_match( KEY_PATTERN, $key ) ? encrypt_secret( $key ) : '',
			)
		);
		add_notice( 'error', $result->get_error_message() );
		go_back( array( 'view' => 'websites' ) );
	}

	if ( '' === $key ) {
		add_notice( 'success', 'Website saved.' );
		go_back( array( 'view' => 'websites' ) );
	}

	$sync = sync_site( $result, 'pairing' );
	if ( is_wp_error( $sync ) ) {
		add_notice( 'warning', 'The website was saved, but WP Control could not read it yet: ' . $sync->get_error_message() );
	} else {
		add_notice( 'success', 'The website is connected and its data was read.' );
	}
	go_back( array( 'view' => 'websites' ) );
}

function handle_delete_site() {
	verify_request( 'wpc_delete_site' );
	report( delete_site( absint( $_POST['id'] ?? 0 ) ), 'Website deleted.' );
	go_back( array( 'view' => 'websites' ) );
}

function handle_sync_site() {
	verify_request( 'wpc_sync_site' );
	report_sync( sync_site( absint( $_POST['site_id'] ?? 0 ), 'manual' ) );
	go_back();
}

function handle_sync_selected() {
	verify_request( 'wpc_sync_selected' );
	$ids = array_unique( array_filter( array_map( 'absint', (array) wp_unslash( $_POST['sites'] ?? array() ) ) ) );
	if ( empty( $ids ) ) {
		add_notice( 'warning', 'Select at least one website.' );
		go_back();
	}
	queue_sync( $ids );
	add_notice( 'success', 'Sync started for ' . plural( count( $ids ), 'website', 'websites' ) . '. Refresh this page in a minute.' );
	go_back();
}

function handle_sync_all() {
	verify_request( 'wpc_sync_all' );
	queue_sync( array() );
	add_notice( 'success', 'Sync started for all websites. Refresh this page in a minute.' );
	go_back();
}

function handle_save_log() {
	verify_request( 'wpc_save_log' );
	$data   = wp_unslash( $_POST );
	$id     = absint( $data['id'] ?? 0 );
	$result = save_log( $data, $id );
	if ( is_wp_error( $result ) ) {
		remember_input(
			'log',
			array(
				'id'           => $id,
				'site_id'      => absint( $data['site_id'] ?? 0 ),
				'performed_at' => clean_text( sanitize_text_field( $data['performed_at'] ?? '' ), 20 ),
				'performer_id' => absint( $data['performer_id'] ?? 0 ),
				'category'     => sanitize_key( $data['category'] ?? '' ),
				'description'  => clean_textarea( $data['description'] ?? '', 2000 ),
				'duration'     => clean_text( sanitize_text_field( $data['duration'] ?? '' ), 10 ),
				'notes'        => clean_textarea( $data['notes'] ?? '', 5000 ),
				'events'       => array_map( 'absint', (array) ( $data['events'] ?? array() ) ),
			)
		);
	}
	report( $result, $id ? 'Maintenance record saved.' : 'Maintenance record added.' );
	go_back( array( 'view' => 'maintenance' ) );
}

function handle_delete_log() {
	verify_request( 'wpc_delete_log' );
	report( delete_log( absint( $_POST['id'] ?? 0 ) ), 'Maintenance record deleted.' );
	go_back( array( 'view' => 'maintenance' ) );
}

function handle_save_notes() {
	verify_request( 'wpc_save_notes' );
	$site_id = absint( $_POST['site_id'] ?? 0 );
	$notes   = isset( $_POST['notes'] ) ? wp_unslash( $_POST['notes'] ) : '';
	report( save_notes( $site_id, $notes ), 'Notes saved.' );
	go_back();
}

function handle_save_settings() {
	verify_request( 'wpc_save_settings' );
	report( save_settings( wp_unslash( $_POST ) ), 'Settings saved.' );
	go_back( array( 'view' => 'settings' ) );
}

function handle_export() {
	verify_request( 'wpc_export' );
	$type    = sanitize_key( $_POST['type'] ?? '' );
	$month   = sanitize_text_field( wp_unslash( $_POST['month'] ?? '' ) );
	$filters = array(
		'site'  => absint( $_POST['site'] ?? 0 ),
		'month' => valid_month( $month ) ? $month : '',
	);

	$rows = export_rows( $type, $filters );
	if ( is_wp_error( $rows ) ) {
		add_notice( 'error', $rows->get_error_message() );
		go_back( array( 'view' => 'reports' ) );
	}
	audit( 'export', 'report', 0, $filters['site'], $type . ' (' . ( count( $rows ) - 1 ) . ' rows)' );
	send_csv( 'wp-control-' . $type . '-' . gmdate( 'Y-m-d' ) . '.csv', $rows );
}
