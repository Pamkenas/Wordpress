<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const SITE_TABS = array(
	'overview'    => 'Overview',
	'updates'     => 'Updates',
	'maintenance' => 'Maintenance',
	'backups'     => 'Backups',
	'security'    => 'Security',
	'activity'    => 'Activity',
	'notes'       => 'Notes',
);

function render_site_drawer( $site_id ) {
	$site  = get_site_row( $site_id );
	$close = current_url(
		array(
			'site'   => null,
			'tab'    => null,
			'filter' => null,
			'link'   => null,
			'log'    => null,
		)
	);

	echo '<aside class="wpc-drawer" aria-label="Website details">';
	if ( ! $site ) {
		echo '<div class="wpc-drawer__header"><h2>Website not found</h2><a class="wpc-close" href="' . esc_url( $close ) . '" aria-label="Close">&times;</a></div></aside>';
		return;
	}

	$tab = sanitize_key( query_arg( 'tab' ) );
	if ( ! isset( SITE_TABS[ $tab ] ) ) {
		$tab = 'overview';
	}

	echo '<div class="wpc-drawer__header"><div>';
	echo '<h2 class="wpc-drawer__title">' . esc_html( $site->name ) . ' <a class="wpc-external" href="' . esc_url( $site->url ) . '" target="_blank" rel="noopener noreferrer" title="Open the website"><span class="dashicons dashicons-external"></span></a></h2>';
	echo '<div class="wpc-muted">' . esc_html( $site->client_name ? $site->client_name : 'No client' ) . '</div>';
	echo '<div class="wpc-drawer__status">' . status_badge( $site->status ) . ' <span class="wpc-muted">Last sync: ' . esc_html( time_ago( $site->last_sync_at ) ) . '</span></div>';
	echo '</div><a class="wpc-close" href="' . esc_url( $close ) . '" aria-label="Close">&times;</a></div>';

	echo '<nav class="wpc-tabs">';
	foreach ( SITE_TABS as $key => $label ) {
		$class = $key === $tab ? 'wpc-tab is-active' : 'wpc-tab';
		echo '<a class="' . esc_attr( $class ) . '" href="' . esc_url( site_url_for( (int) $site->id, $key ) ) . '">' . esc_html( $label ) . '</a>';
	}
	echo '</nav><div class="wpc-drawer__body">';
	call_user_func( __NAMESPACE__ . '\render_site_' . $tab, $site );
	echo '</div></aside>';
}

function key_values( $rows ) {
	echo '<dl class="wpc-list">';
	foreach ( $rows as $label => $html ) {
		echo '<dt>' . esc_html( $label ) . '</dt><dd>' . $html . '</dd>';
	}
	echo '</dl>';
}

function render_site_overview( $site ) {
	$components = site_components( (int) $site->id );
	$agent      = get_agent_row( (int) $site->id );
	$last_log   = last_log( (int) $site->id );

	$plugins = 0;
	$active  = 0;
	foreach ( $components as $component ) {
		if ( 'plugin' === $component->type ) {
			++$plugins;
			if ( 'active' === $component->status ) {
				++$active;
			}
		}
	}

	echo '<div class="wpc-row-actions">' . button_form( 'wpc_sync_site', 'Sync now', array( 'site_id' => (int) $site->id ), 'wpc-btn wpc-btn--primary' ) . '</div>';
	if ( ! empty( $site->last_error ) ) {
		echo '<div class="wpc-notice wpc-notice--error"><strong>Last sync failed</strong> (' . esc_html( time_ago( $site->last_attempt_at ) ) . '): ' . esc_html( $site->last_error ) . '</div>';
	}
	if ( 'pending' === $site->status && empty( $site->last_error ) ) {
		echo '<div class="wpc-notice wpc-notice--warning">This website was not read yet. Click Sync now.</div>';
	}

	$maintenance = '—';
	if ( $last_log ) {
		$maintenance = esc_html( local_date( $last_log->performed_at, 'j M Y' ) ) . ' · ' . avatar( $last_log->performer_name ) . esc_html( $last_log->performer_name );
	}

	key_values(
		array(
			'Website'          => '<a href="' . esc_url( $site->url ) . '" target="_blank" rel="noopener noreferrer">' . esc_html( $site->url ) . '</a>',
			'Status'           => status_badge( $site->status ),
			'WordPress'        => esc_html( '' === $site->wp_version ? '—' : $site->wp_version ),
			'PHP'              => esc_html( '' === $site->php_version ? '—' : $site->php_version ),
			'Active theme'     => esc_html( '' === $site->active_theme ? '—' : $site->active_theme ),
			'Plugins'          => esc_html( $plugins . ' (' . $active . ' active)' ),
			'Updates waiting'  => updates_badge( $site->pending_updates ),
			'Manual check'     => esc_html( (string) (int) $site->unknown_updates ),
			'Critical issues'  => (int) $site->critical_issues > 0 ? badge( 'critical', (string) (int) $site->critical_issues ) : badge( 'ok', 'None' ),
			'Last backup'      => backup_badge( $site->last_backup_at ),
			'Last maintenance' => $maintenance,
			'Agent'            => esc_html( $agent && '' !== $agent->agent_version ? 'WP Control Agent ' . $agent->agent_version : '—' ),
			'Connected since'  => esc_html( $agent ? local_date( $agent->paired_at, 'j M Y' ) : '—' ),
			'Last sync'        => esc_html( local_date( $site->last_sync_at ) ),
		)
	);
}

function render_site_updates( $site ) {
	$components = site_components( (int) $site->id );
	$since      = offer_dates( (int) $site->id );
	$filter     = sanitize_key( query_arg( 'filter' ) );
	$groups     = array(
		'all'     => 'All',
		'plugins' => 'Plugins',
		'themes'  => 'Themes',
		'core'    => 'Core',
	);
	if ( ! isset( $groups[ $filter ] ) ) {
		$filter = 'all';
	}

	$pending = array();
	$unknown = array();
	$counts  = array_fill_keys( array_keys( $groups ), 0 );
	foreach ( $components as $component ) {
		$group = 'plugins';
		if ( 'theme' === $component->type ) {
			$group = 'themes';
		} elseif ( 'core' === $component->type ) {
			$group = 'core';
		}
		if ( 'unknown' === $component->update_state ) {
			$unknown[] = $component;
		}
		if ( 'yes' !== $component->update_state ) {
			continue;
		}
		++$counts['all'];
		++$counts[ $group ];
		if ( 'all' === $filter || $group === $filter ) {
			$pending[] = $component;
		}
	}

	echo '<div class="wpc-box wpc-box--split"><div><div class="wpc-muted">Updates available</div><div class="wpc-big">' . (int) $counts['all'] . '</div>';
	echo '<div class="wpc-muted wpc-small">' . esc_html( plural( $counts['plugins'], 'plugin', 'plugins' ) . ' · ' . plural( $counts['themes'], 'theme', 'themes' ) . ' · ' . plural( $counts['core'], 'WordPress update', 'WordPress updates' ) ) . '</div></div>';
	echo '<div class="wpc-right">' . button_form( 'wpc_sync_site', 'Check again', array( 'site_id' => (int) $site->id ), 'wpc-btn' );
	echo '<div class="wpc-muted wpc-small">Last checked: ' . esc_html( time_ago( $site->last_sync_at ) ) . '</div></div></div>';

	echo '<div class="wpc-chips">';
	foreach ( $groups as $key => $label ) {
		$class = $key === $filter ? 'wpc-chip is-active' : 'wpc-chip';
		echo '<a class="' . esc_attr( $class ) . '" href="' . esc_url( current_url( array( 'filter' => $key ) ) ) . '">' . esc_html( $label . ' (' . $counts[ $key ] . ')' ) . '</a>';
	}
	echo '</div>';

	if ( empty( $pending ) ) {
		empty_state( 'No known updates are waiting.' );
	} else {
		echo '<table class="wpc-table"><thead><tr><th>Name</th><th>Type</th><th>Current</th><th>New</th><th>Waiting since</th></tr></thead><tbody>';
		foreach ( $pending as $component ) {
			echo '<tr><td>' . esc_html( $component->name ) . '</td><td>' . esc_html( type_label( $component->type ) ) . '</td>';
			echo '<td>' . esc_html( $component->version ) . '</td><td class="wpc-strong">' . esc_html( $component->update_version ) . '</td>';
			echo '<td>' . esc_html( isset( $since[ (int) $component->id ] ) ? local_date( $since[ (int) $component->id ], 'j M Y' ) : '—' ) . '</td></tr>';
		}
		echo '</tbody></table>';
	}
	echo '<p class="wpc-help">WP Control only reads updates. Install them in the site\'s wp-admin, then add a maintenance record.</p>';

	if ( ! empty( $unknown ) ) {
		echo '<h3 class="wpc-h3">Needs a manual check (' . count( $unknown ) . ')</h3>';
		echo '<table class="wpc-table"><thead><tr><th>Name</th><th>Type</th><th>Version</th><th>Why</th></tr></thead><tbody>';
		foreach ( $unknown as $component ) {
			echo '<tr><td>' . esc_html( $component->name ) . '</td><td>' . esc_html( type_label( $component->type ) ) . '</td><td>' . esc_html( $component->version ) . '</td><td class="wpc-muted">' . esc_html( $component->update_note ) . '</td></tr>';
		}
		echo '</tbody></table>';
	}

	$events        = find_events( array( 'site' => (int) $site->id ), 30 );
	$documentation = event_documentation( $events );
	echo '<h3 class="wpc-h3">Update history</h3>';
	if ( empty( $events ) ) {
		empty_state( 'No changes detected yet. Changes appear after the next syncs.' );
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>Detected</th><th>Item</th><th>Change</th><th>Documented by</th></tr></thead><tbody>';
	foreach ( $events as $event ) {
		$document = '';
		if ( empty( $documentation[ (int) $event->id ] ) ) {
			$document = ' <a class="wpc-link" href="' . esc_url( site_url_for( (int) $site->id, 'maintenance' ) . '&link=' . (int) $event->id ) . '">Document</a>';
		}
		echo '<tr><td>' . esc_html( local_date( $event->detected_at, 'j M Y' ) ) . '</td>';
		echo '<td>' . esc_html( $event->name ) . '<div class="wpc-muted wpc-small">' . esc_html( type_label( $event->type ) . ' · ' . event_label( $event->event ) ) . '</div></td>';
		echo '<td>' . esc_html( event_change( $event ) ) . '</td>';
		echo '<td>' . documented_by( $event, $documentation ) . $document . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">A detected change shows what changed, not who changed it. Add a maintenance record to document it.</p>';
}

function render_site_maintenance( $site ) {
	$log_id = absint( query_arg( 'log' ) );
	$log    = $log_id ? get_log( $log_id ) : null;
	if ( $log && (int) $log->site_id !== (int) $site->id ) {
		$log = null;
	}

	render_log_form( (int) $site->id, $log, absint( query_arg( 'link' ) ) );
	echo '<h3 class="wpc-h3">Maintenance history</h3>';
	render_logs( find_logs( array( 'site' => (int) $site->id ), 100 ), false );
}

function format_size( $bytes ) {
	if ( null === $bytes || '' === $bytes ) {
		return '—';
	}
	return size_format( (int) $bytes, 1 );
}

function render_site_backups( $site ) {
	$backups = site_backups( (int) $site->id );
	$latest  = $backups ? $backups[0] : null;

	if ( ! $latest ) {
		echo '<div class="wpc-box"><strong>No backups found.</strong><p class="wpc-muted">WP Control reads backups made with UpdraftPlus. Other backup plugins are listed under Security, but their backups can\'t be read yet.</p></div>';
		return;
	}

	$ok = 'success' === $latest->status;
	echo '<div class="wpc-box wpc-box--split"><div><strong>' . ( $ok ? 'Last backup successful' : 'Last backup failed' ) . '</strong>';
	echo '<div class="wpc-muted">' . esc_html( local_date( $latest->backup_at ) . ' (' . time_ago( $latest->backup_at ) . ')' ) . '</div>';
	echo '<div class="wpc-muted wpc-small">' . esc_html( $latest->source . ( '' !== $latest->storage ? ' · ' . $latest->storage : '' ) ) . '</div></div>';
	echo '<div>' . ( $ok ? badge( 'ok', 'Success' ) : badge( 'critical', 'Failed' ) ) . '</div></div>';

	echo '<h3 class="wpc-h3">History</h3><table class="wpc-table"><thead><tr><th>Date</th><th>Status</th><th>Size</th><th>Storage</th></tr></thead><tbody>';
	foreach ( $backups as $backup ) {
		echo '<tr><td>' . esc_html( local_date( $backup->backup_at ) ) . '</td>';
		echo '<td>' . ( 'success' === $backup->status ? badge( 'ok', 'Success' ) : badge( 'critical', 'Failed' ) ) . '</td>';
		echo '<td>' . esc_html( format_size( $backup->size_bytes ) ) . '</td><td>' . esc_html( '' === $backup->storage ? '—' : $backup->storage ) . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">Backups are made on the site. WP Control only shows them.</p>';
}

function render_site_security( $site ) {
	$checks = site_checks( (int) $site->id );
	$counts = array(
		'critical' => 0,
		'moderate' => 0,
		'low'      => 0,
	);
	foreach ( $checks as $item ) {
		if ( isset( $counts[ $item->severity ] ) ) {
			++$counts[ $item->severity ];
		}
	}

	echo '<div class="wpc-mini-cards">';
	foreach ( $counts as $severity => $count ) {
		echo '<div class="wpc-mini wpc-mini--' . esc_attr( $severity ) . '"><span class="wpc-big">' . (int) $count . '</span> ' . esc_html( ucfirst( $severity ) ) . '</div>';
	}
	echo '</div>';

	if ( empty( $checks ) ) {
		empty_state( 'No checks yet. They run with every sync.' );
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>Check</th><th>Severity</th><th>Status</th></tr></thead><tbody>';
	foreach ( $checks as $item ) {
		$status = 'ok' === $item->severity ? badge( 'ok', 'OK' ) : badge( 'offline', 'Open' );
		echo '<tr><td>' . esc_html( $item->title ) . '<div class="wpc-muted wpc-small">' . esc_html( $item->detail ) . '</div></td><td>' . severity_badge( $item->severity ) . '</td><td>' . $status . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">Basic configuration checks from the last sync (' . esc_html( time_ago( $site->last_sync_at ) ) . '). Vulnerability scanning is planned for a later version.</p>';
}

function activity_items( $site_id ) {
	$items = array();
	foreach ( find_events( array( 'site' => $site_id ), 40 ) as $event ) {
		$items[] = array(
			'time' => $event->detected_at,
			'kind' => 'Change',
			'text' => $event->name . ': ' . strtolower( event_label( $event->event ) ) . ' (' . event_change( $event ) . ')',
		);
	}
	foreach ( find_runs( $site_id, 40 ) as $run ) {
		$items[] = array(
			'time' => $run->started_at,
			'kind' => 'Sync',
			'text' => ucfirst( $run->status ) . ' (' . $run->trigger_type . '): ' . $run->message,
		);
	}
	foreach ( find_audit( $site_id, 40 ) as $entry ) {
		$items[] = array(
			'time' => $entry->created_at,
			'kind' => 'Action',
			'text' => $entry->user_name . ': ' . str_replace( '_', ' ', $entry->action ) . ( '' !== (string) $entry->details ? ' – ' . $entry->details : '' ),
		);
	}
	usort(
		$items,
		function ( $a, $b ) {
			return strcmp( $b['time'], $a['time'] );
		}
	);
	return array_slice( $items, 0, 60 );
}

function render_site_activity( $site ) {
	$items = activity_items( (int) $site->id );
	if ( empty( $items ) ) {
		empty_state( 'No activity yet.' );
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>When</th><th>Type</th><th>What happened</th></tr></thead><tbody>';
	foreach ( $items as $item ) {
		echo '<tr><td class="wpc-nowrap">' . esc_html( local_date( $item['time'], 'j M Y, H:i' ) ) . '</td><td>' . esc_html( $item['kind'] ) . '</td><td>' . esc_html( $item['text'] ) . '</td></tr>';
	}
	echo '</tbody></table>';
}

function render_site_notes( $site ) {
	echo form_open( 'wpc_save_notes', 'wpc-form' );
	echo '<input type="hidden" name="site_id" value="' . (int) $site->id . '">';
	echo '<p class="wpc-field"><label for="wpc-notes">Notes for the team (internal)</label><textarea class="wpc-textarea" id="wpc-notes" name="notes" rows="10">' . esc_textarea( (string) $site->notes ) . '</textarea></p>';
	echo '<button class="wpc-btn wpc-btn--primary" type="submit">Save notes</button></form>';

	if ( ! empty( $site->notes_updated_at ) ) {
		$user = get_userdata( (int) $site->notes_updated_by );
		echo '<p class="wpc-help">Last changed ' . esc_html( local_date( $site->notes_updated_at ) ) . ( $user ? ' by ' . esc_html( $user->display_name ) : '' ) . '.</p>';
	}
}
