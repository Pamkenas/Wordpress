<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const ACTIVITY_TABS = array(
	'changes' => 'Detected changes',
	'syncs'   => 'Sync runs',
	'audit'   => 'Audit history',
);

function render_activity() {
	$sub = sanitize_key( query_arg( 'sub' ) );
	if ( ! isset( ACTIVITY_TABS[ $sub ] ) ) {
		$sub = 'changes';
	}

	page_header( 'Activity', 'What changed on the websites, every sync, and every action in WP Control' );
	echo '<nav class="wpc-tabs wpc-tabs--page">';
	foreach ( ACTIVITY_TABS as $key => $label ) {
		$class = $key === $sub ? 'wpc-tab is-active' : 'wpc-tab';
		echo '<a class="' . esc_attr( $class ) . '" href="' . esc_url( page_url( array( 'view' => 'activity', 'sub' => $key ) ) ) . '">' . esc_html( $label ) . '</a>';
	}
	echo '</nav><section class="wpc-panel">';
	call_user_func( __NAMESPACE__ . '\render_activity_' . $sub );
	echo '</section>';
}

function render_activity_changes() {
	$filters = array(
		'site'         => absint( query_arg( 'site_filter' ) ),
		'month'        => valid_month( query_arg( 'month' ) ) ? query_arg( 'month' ) : '',
		'undocumented' => '1' === query_arg( 'undocumented' ),
	);
	echo '<form class="wpc-toolbar" method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '">';
	echo '<input type="hidden" name="page" value="' . esc_attr( PAGE_SLUG ) . '"><input type="hidden" name="view" value="activity"><input type="hidden" name="sub" value="changes">';
	echo select_field( 'site_filter', site_options(), $filters['site'] ? (string) $filters['site'] : '', 'All websites' );
	echo '<input class="wpc-input" type="month" name="month" value="' . esc_attr( $filters['month'] ) . '" aria-label="Month">';
	echo '<label class="wpc-check-label"><input type="checkbox" name="undocumented" value="1"' . checked( $filters['undocumented'], true, false ) . '> Only not documented</label>';
	echo '<button class="wpc-btn" type="submit">Filter</button></form>';

	$events = find_events( $filters, 200 );
	if ( empty( $events ) ) {
		empty_state( 'No detected changes. The first sync of a website is the starting point; changes appear from the second sync on.' );
		return;
	}
	$documentation = event_documentation( $events );
	echo '<table class="wpc-table"><thead><tr><th>Detected</th><th>Website</th><th>Item</th><th>Change</th><th>Documented by</th></tr></thead><tbody>';
	foreach ( $events as $event ) {
		echo '<tr><td class="wpc-nowrap">' . esc_html( local_date( $event->detected_at ) ) . '</td>';
		echo '<td><a href="' . esc_url( site_url_for( (int) $event->site_id, 'updates' ) ) . '">' . esc_html( $event->site_name ? $event->site_name : '—' ) . '</a></td>';
		echo '<td>' . esc_html( $event->name ) . '<div class="wpc-muted wpc-small">' . esc_html( type_label( $event->type ) . ' · ' . event_label( $event->event ) ) . '</div></td>';
		echo '<td>' . esc_html( event_change( $event ) ) . '</td><td>' . documented_by( $event, $documentation ) . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">A detected change alone does not prove who made it. Link it to a maintenance record to document it.</p>';
}

function render_activity_syncs() {
	$runs = find_runs( 0, 100 );
	if ( empty( $runs ) ) {
		empty_state( 'No syncs yet.' );
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>Started</th><th>Website</th><th>Started by</th><th>Result</th><th>Message</th></tr></thead><tbody>';
	foreach ( $runs as $run ) {
		$tone = 'success' === $run->status ? 'ok' : ( 'failed' === $run->status ? 'critical' : 'pending' );
		echo '<tr><td class="wpc-nowrap">' . esc_html( local_date( $run->started_at ) ) . '</td>';
		echo '<td>' . esc_html( $run->site_name ? $run->site_name : '(deleted website)' ) . '</td>';
		echo '<td>' . esc_html( ucfirst( $run->trigger_type ) ) . '</td><td>' . badge( $tone, ucfirst( $run->status ) ) . '</td>';
		echo '<td>' . esc_html( (string) $run->message ) . '</td></tr>';
	}
	echo '</tbody></table>';
}

function render_activity_audit() {
	$entries = find_audit( 0, 200 );
	if ( empty( $entries ) ) {
		empty_state( 'No actions recorded yet.' );
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>';
	foreach ( $entries as $entry ) {
		echo '<tr><td class="wpc-nowrap">' . esc_html( local_date( $entry->created_at ) ) . '</td>';
		echo '<td class="wpc-nowrap">' . avatar( $entry->user_name ) . esc_html( $entry->user_name ) . '</td>';
		echo '<td>' . esc_html( ucfirst( str_replace( '_', ' ', $entry->action ) ) ) . '</td><td>' . esc_html( (string) $entry->details ) . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">Every change made in WP Control is recorded here, with the person who made it.</p>';
}
