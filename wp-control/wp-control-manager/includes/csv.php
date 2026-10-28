<?php

namespace WPControlManager;

use WP_Error;

defined( 'ABSPATH' ) || exit;

const EXPORTS = array(
	'websites'    => 'Websites',
	'components'  => 'Plugins, themes and WordPress',
	'updates'     => 'Pending updates',
	'changes'     => 'Detected changes',
	'maintenance' => 'Maintenance log',
);

function csv_cell( $value ) {
	$text = (string) $value;
	if ( '' !== $text && false !== strpos( "=+-@\t\r", $text[0] ) ) {
		$text = "'" . $text;
	}
	return $text;
}

function csv_string( $rows, $delimiter ) {
	$handle = fopen( 'php://temp', 'r+' );
	fwrite( $handle, chr( 239 ) . chr( 187 ) . chr( 191 ) );
	foreach ( $rows as $row ) {
		fputcsv( $handle, array_map( __NAMESPACE__ . '\csv_cell', $row ), $delimiter, '"', '' );
	}
	rewind( $handle );
	$csv = stream_get_contents( $handle );
	fclose( $handle );
	return $csv;
}

function export_sites( $site_id ) {
	global $wpdb;
	$sql = 'SELECT s.*, c.name AS client_name FROM ' . table( 'sites' ) . ' s LEFT JOIN ' . table( 'clients' ) . ' c ON c.id = s.client_id';
	if ( $site_id ) {
		return $wpdb->get_results( $wpdb->prepare( $sql . ' WHERE s.id = %d', $site_id ) );
	}
	return $wpdb->get_results( $sql . ' ORDER BY s.name ASC' );
}

function export_components( $site_id, $only_updates ) {
	global $wpdb;
	$where  = array( 'k.removed_at IS NULL' );
	$params = array();
	if ( $site_id ) {
		$where[]  = 'k.site_id = %d';
		$params[] = $site_id;
	}
	if ( $only_updates ) {
		$where[] = "k.update_state = 'yes'";
	}
	$sql = 'SELECT k.*, s.name AS site_name, c.name AS client_name, o.first_seen_at AS offered_since FROM ' . table( 'components' ) . ' k'
		. ' JOIN ' . table( 'sites' ) . ' s ON s.id = k.site_id'
		. ' LEFT JOIN ' . table( 'clients' ) . ' c ON c.id = s.client_id'
		. ' LEFT JOIN ' . table( 'update_offers' ) . ' o ON o.component_id = k.id AND o.resolved_at IS NULL'
		. ' WHERE ' . implode( ' AND ', $where )
		. " ORDER BY s.name ASC, FIELD(k.type, 'core', 'plugin', 'must-use', 'drop-in', 'theme'), k.name ASC";
	return $params ? $wpdb->get_results( $wpdb->prepare( $sql, $params ) ) : $wpdb->get_results( $sql );
}

function export_rows( $type, $filters ) {
	$site_id = (int) $filters['site'];
	$rows    = array();

	if ( 'websites' === $type ) {
		$rows[] = array( 'Client', 'Website', 'Address', 'Status', 'WordPress', 'PHP', 'Pending updates', 'Need a manual check', 'Critical issues', 'Last backup', 'Last sync', 'Last error' );
		foreach ( export_sites( $site_id ) as $site ) {
			$rows[] = array(
				(string) $site->client_name,
				$site->name,
				$site->url,
				STATUS_LABELS[ $site->status ] ?? $site->status,
				$site->wp_version,
				$site->php_version,
				(int) $site->pending_updates,
				(int) $site->unknown_updates,
				(int) $site->critical_issues,
				$site->last_backup_at ? local_date( $site->last_backup_at, 'Y-m-d H:i' ) : '',
				$site->last_sync_at ? local_date( $site->last_sync_at, 'Y-m-d H:i' ) : '',
				(string) $site->last_error,
			);
		}
		return $rows;
	}

	if ( 'components' === $type || 'updates' === $type ) {
		$only_updates = 'updates' === $type;
		$rows[]       = $only_updates
			? array( 'Client', 'Website', 'Type', 'Name', 'Identifier', 'Current version', 'New version', 'Waiting since' )
			: array( 'Client', 'Website', 'Type', 'Name', 'Identifier', 'Version', 'Status', 'Update available', 'New version', 'Note', 'Auto-updates' );
		foreach ( export_components( $site_id, $only_updates ) as $item ) {
			if ( $only_updates ) {
				$rows[] = array( (string) $item->client_name, $item->site_name, type_label( $item->type ), $item->name, $item->slug, $item->version, $item->update_version, $item->offered_since ? local_date( $item->offered_since, 'Y-m-d' ) : '' );
				continue;
			}
			$rows[] = array( (string) $item->client_name, $item->site_name, type_label( $item->type ), $item->name, $item->slug, $item->version, $item->status, $item->update_state, $item->update_version, $item->update_note, $item->auto_update ? 'on' : 'off' );
		}
		return $rows;
	}

	if ( 'changes' === $type ) {
		$events        = find_events( $filters, 5000 );
		$documentation = event_documentation( $events );
		$rows[]        = array( 'Detected', 'Client', 'Website', 'Type', 'Item', 'Change', 'From', 'To', 'Documented by' );
		foreach ( $events as $event ) {
			$names = array();
			foreach ( $documentation[ (int) $event->id ] ?? array() as $row ) {
				$names[] = $row->performer_name;
			}
			$rows[] = array( local_date( $event->detected_at, 'Y-m-d H:i' ), (string) $event->client_name, (string) $event->site_name, type_label( $event->type ), $event->name, event_label( $event->event ), $event->old_value, $event->new_value, implode( ', ', array_unique( $names ) ) );
		}
		return $rows;
	}

	if ( 'maintenance' === $type ) {
		$logs   = find_logs( $filters, 5000 );
		$links  = linked_events( $logs );
		$rows[] = array( 'Performed', 'Client', 'Website', 'Performed by', 'Category', 'Work', 'Minutes', 'Notes', 'Linked changes' );
		foreach ( $logs as $log ) {
			$changes = array();
			foreach ( $links[ (int) $log->id ] ?? array() as $event ) {
				$changes[] = $event->name . ' ' . event_change( $event );
			}
			$rows[] = array( local_date( $log->performed_at, 'Y-m-d H:i' ), (string) $log->client_name, (string) $log->site_name, $log->performer_name, CATEGORIES[ $log->category ] ?? $log->category, $log->description, null === $log->duration_minutes ? '' : (int) $log->duration_minutes, (string) $log->notes, implode( '; ', $changes ) );
		}
		return $rows;
	}

	return new WP_Error( 'wpc_export', 'Choose what to export.' );
}

function send_csv( $filename, $rows ) {
	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename="' . sanitize_file_name( $filename ) . '"' );
	header( 'X-Content-Type-Options: nosniff' );
	echo csv_string( $rows, settings()['csv_delimiter'] );
	exit;
}
