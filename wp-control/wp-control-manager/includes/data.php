<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function get_site_row( $id ) {
	global $wpdb;
	return $wpdb->get_row(
		$wpdb->prepare(
			'SELECT s.*, c.name AS client_name FROM ' . table( 'sites' ) . ' s LEFT JOIN ' . table( 'clients' ) . ' c ON c.id = s.client_id WHERE s.id = %d',
			$id
		)
	);
}

function get_agent_row( $site_id ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . table( 'agents' ) . ' WHERE site_id = %d', $site_id ) );
}

function find_sites( $filters, $page = 1, $per_page = 20 ) {
	global $wpdb;
	$where  = array( '1=1' );
	$params = array();

	if ( ! empty( $filters['search'] ) ) {
		$like     = '%' . $wpdb->esc_like( $filters['search'] ) . '%';
		$where[]  = '(s.name LIKE %s OR s.url LIKE %s OR c.name LIKE %s)';
		$params[] = $like;
		$params[] = $like;
		$params[] = $like;
	}
	if ( ! empty( $filters['client'] ) ) {
		$where[]  = 's.client_id = %d';
		$params[] = (int) $filters['client'];
	}
	if ( ! empty( $filters['status'] ) ) {
		$where[]  = 's.status = %s';
		$params[] = $filters['status'];
	}

	$from  = ' FROM ' . table( 'sites' ) . ' s LEFT JOIN ' . table( 'clients' ) . ' c ON c.id = s.client_id WHERE ' . implode( ' AND ', $where );
	$count = 'SELECT COUNT(*)' . $from;
	$total = (int) ( $params ? $wpdb->get_var( $wpdb->prepare( $count, $params ) ) : $wpdb->get_var( $count ) );

	$list_params   = $params;
	$list_params[] = $per_page;
	$list_params[] = max( 0, ( $page - 1 ) * $per_page );
	$rows          = $wpdb->get_results( $wpdb->prepare( 'SELECT s.*, c.name AS client_name' . $from . ' ORDER BY s.name ASC LIMIT %d OFFSET %d', $list_params ) );

	return array(
		'rows'  => $rows,
		'total' => $total,
	);
}

function all_sites() {
	global $wpdb;
	return $wpdb->get_results( 'SELECT id, name FROM ' . table( 'sites' ) . ' ORDER BY name ASC' );
}

function get_clients() {
	global $wpdb;
	return $wpdb->get_results(
		'SELECT c.*, COUNT(s.id) AS site_count FROM ' . table( 'clients' ) . ' c LEFT JOIN ' . table( 'sites' ) . ' s ON s.client_id = c.id GROUP BY c.id ORDER BY c.name ASC'
	);
}

function get_client( $id ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . table( 'clients' ) . ' WHERE id = %d', $id ) );
}

function overview_stats() {
	global $wpdb;
	$row = $wpdb->get_row(
		"SELECT COUNT(*) AS total, SUM(status = 'online') AS online, SUM(pending_updates) AS updates, SUM(critical_issues) AS critical FROM " . table( 'sites' )
	);
	return array(
		'total'    => (int) $row->total,
		'online'   => (int) $row->online,
		'updates'  => (int) $row->updates,
		'critical' => (int) $row->critical,
	);
}

function site_components( $site_id ) {
	global $wpdb;
	return $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM " . table( 'components' ) . " WHERE site_id = %d AND removed_at IS NULL ORDER BY FIELD(type, 'core', 'plugin', 'must-use', 'drop-in', 'theme'), name ASC",
			$site_id
		)
	);
}

function offer_dates( $site_id ) {
	global $wpdb;
	$rows = $wpdb->get_results(
		$wpdb->prepare( 'SELECT component_id, first_seen_at FROM ' . table( 'update_offers' ) . ' WHERE site_id = %d AND resolved_at IS NULL', $site_id )
	);
	$dates = array();
	foreach ( $rows as $row ) {
		$dates[ (int) $row->component_id ] = $row->first_seen_at;
	}
	return $dates;
}

function event_documentation( $events ) {
	global $wpdb;
	$ids = array();
	foreach ( $events as $event ) {
		$ids[] = (int) $event->id;
	}
	if ( empty( $ids ) ) {
		return array();
	}

	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$rows         = $wpdb->get_results(
		$wpdb->prepare(
			'SELECT l.event_id, m.id AS log_id, m.performer_name FROM ' . table( 'maintenance_event_links' ) . ' l JOIN ' . table( 'maintenance_logs' ) . " m ON m.id = l.log_id WHERE l.event_id IN ($placeholders) ORDER BY m.performed_at ASC",
			$ids
		)
	);

	$map = array();
	foreach ( $rows as $row ) {
		$map[ (int) $row->event_id ][] = $row;
	}
	return $map;
}

function find_events( $filters, $limit = 100 ) {
	global $wpdb;
	$where  = array( '1=1' );
	$params = array();
	if ( ! empty( $filters['site'] ) ) {
		$where[]  = 'e.site_id = %d';
		$params[] = (int) $filters['site'];
	}
	if ( ! empty( $filters['month'] ) && valid_month( $filters['month'] ) ) {
		$range    = month_range( $filters['month'] );
		$where[]  = 'e.detected_at >= %s AND e.detected_at < %s';
		$params[] = $range[0];
		$params[] = $range[1];
	}
	if ( ! empty( $filters['undocumented'] ) ) {
		$where[] = 'NOT EXISTS (SELECT 1 FROM ' . table( 'maintenance_event_links' ) . ' l WHERE l.event_id = e.id)';
	}
	$params[] = $limit;

	return $wpdb->get_results(
		$wpdb->prepare(
			'SELECT e.*, s.name AS site_name, c.name AS client_name FROM ' . table( 'component_events' ) . ' e LEFT JOIN ' . table( 'sites' ) . ' s ON s.id = e.site_id LEFT JOIN ' . table( 'clients' ) . ' c ON c.id = s.client_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY e.detected_at DESC, e.id DESC LIMIT %d',
			$params
		)
	);
}

function get_events_by_ids( $site_id, $ids ) {
	global $wpdb;
	$ids = array_values( array_filter( array_map( 'absint', (array) $ids ) ) );
	if ( empty( $ids ) ) {
		return array();
	}
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$params       = array_merge( array( $site_id ), $ids );
	return $wpdb->get_results(
		$wpdb->prepare( 'SELECT * FROM ' . table( 'component_events' ) . " WHERE site_id = %d AND id IN ($placeholders)", $params )
	);
}

function site_checks( $site_id ) {
	global $wpdb;
	return $wpdb->get_results(
		$wpdb->prepare(
			"SELECT * FROM " . table( 'site_checks' ) . " WHERE site_id = %d ORDER BY FIELD(severity, 'critical', 'moderate', 'low', 'ok'), id ASC",
			$site_id
		)
	);
}

function open_issues() {
	global $wpdb;
	return $wpdb->get_results(
		"SELECT k.*, s.name AS site_name FROM " . table( 'site_checks' ) . ' k JOIN ' . table( 'sites' ) . " s ON s.id = k.site_id WHERE k.severity <> 'ok' ORDER BY FIELD(k.severity, 'critical', 'moderate', 'low'), s.name ASC"
	);
}

function site_backups( $site_id, $limit = 20 ) {
	global $wpdb;
	return $wpdb->get_results(
		$wpdb->prepare( 'SELECT * FROM ' . table( 'backups' ) . ' WHERE site_id = %d ORDER BY backup_at DESC LIMIT %d', $site_id, $limit )
	);
}

function latest_backups() {
	global $wpdb;
	$rows = $wpdb->get_results(
		'SELECT b.* FROM ' . table( 'backups' ) . ' b JOIN (SELECT site_id, MAX(backup_at) AS newest FROM ' . table( 'backups' ) . ' GROUP BY site_id) n ON n.site_id = b.site_id AND n.newest = b.backup_at'
	);
	$map = array();
	foreach ( $rows as $row ) {
		$map[ (int) $row->site_id ] = $row;
	}
	return $map;
}

function find_logs( $filters, $limit = 200 ) {
	global $wpdb;
	$where  = array( '1=1' );
	$params = array();
	if ( ! empty( $filters['site'] ) ) {
		$where[]  = 'm.site_id = %d';
		$params[] = (int) $filters['site'];
	}
	if ( ! empty( $filters['performer'] ) ) {
		$where[]  = 'm.performer_id = %d';
		$params[] = (int) $filters['performer'];
	}
	if ( ! empty( $filters['category'] ) ) {
		$where[]  = 'm.category = %s';
		$params[] = $filters['category'];
	}
	if ( ! empty( $filters['month'] ) && valid_month( $filters['month'] ) ) {
		$range    = month_range( $filters['month'] );
		$where[]  = 'm.performed_at >= %s AND m.performed_at < %s';
		$params[] = $range[0];
		$params[] = $range[1];
	}
	$params[] = $limit;

	return $wpdb->get_results(
		$wpdb->prepare(
			'SELECT m.*, s.name AS site_name, c.name AS client_name FROM ' . table( 'maintenance_logs' ) . ' m LEFT JOIN ' . table( 'sites' ) . ' s ON s.id = m.site_id LEFT JOIN ' . table( 'clients' ) . ' c ON c.id = s.client_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY m.performed_at DESC, m.id DESC LIMIT %d',
			$params
		)
	);
}

function get_log( $id ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . table( 'maintenance_logs' ) . ' WHERE id = %d', $id ) );
}

function linked_events( $logs ) {
	global $wpdb;
	$ids = array();
	foreach ( $logs as $log ) {
		$ids[] = (int) $log->id;
	}
	if ( empty( $ids ) ) {
		return array();
	}

	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$rows         = $wpdb->get_results(
		$wpdb->prepare(
			'SELECT l.log_id, e.* FROM ' . table( 'maintenance_event_links' ) . ' l JOIN ' . table( 'component_events' ) . " e ON e.id = l.event_id WHERE l.log_id IN ($placeholders) ORDER BY e.detected_at ASC",
			$ids
		)
	);

	$map = array();
	foreach ( $rows as $row ) {
		$map[ (int) $row->log_id ][] = $row;
	}
	return $map;
}

function linked_event_ids( $log_id ) {
	global $wpdb;
	return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT event_id FROM ' . table( 'maintenance_event_links' ) . ' WHERE log_id = %d', $log_id ) ) );
}

function last_log( $site_id ) {
	global $wpdb;
	return $wpdb->get_row(
		$wpdb->prepare( 'SELECT * FROM ' . table( 'maintenance_logs' ) . ' WHERE site_id = %d ORDER BY performed_at DESC, id DESC LIMIT 1', $site_id )
	);
}

function find_runs( $site_id = 0, $limit = 50 ) {
	global $wpdb;
	if ( $site_id ) {
		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT r.*, s.name AS site_name FROM ' . table( 'sync_runs' ) . ' r LEFT JOIN ' . table( 'sites' ) . ' s ON s.id = r.site_id WHERE r.site_id = %d ORDER BY r.started_at DESC, r.id DESC LIMIT %d',
				$site_id,
				$limit
			)
		);
	}
	return $wpdb->get_results(
		$wpdb->prepare(
			'SELECT r.*, s.name AS site_name FROM ' . table( 'sync_runs' ) . ' r LEFT JOIN ' . table( 'sites' ) . ' s ON s.id = r.site_id ORDER BY r.started_at DESC, r.id DESC LIMIT %d',
			$limit
		)
	);
}

function find_audit( $site_id = 0, $limit = 100 ) {
	global $wpdb;
	if ( $site_id ) {
		return $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM ' . table( 'audit_log' ) . ' WHERE site_id = %d ORDER BY created_at DESC, id DESC LIMIT %d', $site_id, $limit )
		);
	}
	return $wpdb->get_results(
		$wpdb->prepare( 'SELECT * FROM ' . table( 'audit_log' ) . ' ORDER BY created_at DESC, id DESC LIMIT %d', $limit )
	);
}
