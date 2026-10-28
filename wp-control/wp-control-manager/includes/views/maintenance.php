<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function log_form_values( $site_id, $log, $link_event ) {
	$old = old_input( 'log' );
	if ( ! empty( $old ) && (int) ( $old['id'] ?? 0 ) !== ( $log ? (int) $log->id : 0 ) ) {
		$old = array();
	}
	if ( ! empty( $old ) ) {
		return $old;
	}
	if ( $log ) {
		return array(
			'site_id'      => (int) $log->site_id,
			'performed_at' => get_date_from_gmt( $log->performed_at, 'Y-m-d\TH:i' ),
			'performer_id' => (int) $log->performer_id,
			'category'     => $log->category,
			'description'  => $log->description,
			'duration'     => null === $log->duration_minutes ? '' : (string) $log->duration_minutes,
			'notes'        => (string) $log->notes,
			'events'       => linked_event_ids( (int) $log->id ),
		);
	}
	return array(
		'site_id'      => $site_id,
		'performed_at' => current_time( 'Y-m-d\TH:i' ),
		'performer_id' => get_current_user_id(),
		'category'     => 'update',
		'description'  => '',
		'duration'     => '',
		'notes'        => '',
		'events'       => $link_event ? array( $link_event ) : array(),
	);
}

function render_event_choices( $site_id, $selected ) {
	$events        = find_events( array( 'site' => $site_id ), 50 );
	$documentation = event_documentation( $events );
	echo '<fieldset class="wpc-field"><legend>Linked detected changes (optional)</legend>';
	if ( empty( $events ) ) {
		echo '<p class="wpc-muted">No changes were detected on this website yet.</p></fieldset>';
		return;
	}
	echo '<div class="wpc-choices">';
	foreach ( $events as $event ) {
		$checked = in_array( (int) $event->id, array_map( 'intval', (array) $selected ), true );
		$note    = empty( $documentation[ (int) $event->id ] ) ? 'not documented yet' : 'already documented';
		echo '<label class="wpc-choice"><input type="checkbox" name="events[]" value="' . (int) $event->id . '"' . checked( $checked, true, false ) . '> ';
		echo esc_html( $event->name . ': ' . strtolower( event_label( $event->event ) ) . ' ' . event_change( $event ) );
		echo ' <span class="wpc-muted wpc-small">(' . esc_html( local_date( $event->detected_at, 'j M Y' ) . ', ' . $note ) . ')</span></label>';
	}
	echo '</div></fieldset>';
}

function render_log_form( $site_id, $log, $link_event = 0 ) {
	$values = log_form_values( $site_id, $log, $link_event );

	echo '<section class="wpc-box"><h3 class="wpc-h3 wpc-h3--first">' . ( $log ? 'Edit maintenance record' : 'Add maintenance record' ) . '</h3>';
	echo form_open( 'wpc_save_log', 'wpc-form' );
	echo '<input type="hidden" name="id" value="' . (int) ( $log ? $log->id : 0 ) . '">';

	echo '<div class="wpc-grid-2">';
	if ( $site_id ) {
		echo '<input type="hidden" name="site_id" value="' . (int) $site_id . '">';
	} else {
		echo '<p class="wpc-field"><label for="wpc-log-site">Website</label>' . select_field( 'site_id', site_options(), (string) $values['site_id'], 'Choose a website', 'wpc-log-site' ) . '</p>';
	}
	echo '<p class="wpc-field"><label for="wpc-log-date">Performed</label><input class="wpc-input" type="datetime-local" id="wpc-log-date" name="performed_at" required value="' . esc_attr( $values['performed_at'] ) . '"></p>';
	echo '<p class="wpc-field"><label for="wpc-log-performer">Performed by</label>' . select_field( 'performer_id', performer_options(), (string) $values['performer_id'], '', 'wpc-log-performer' ) . '</p>';
	echo '<p class="wpc-field"><label for="wpc-log-category">Category</label>' . select_field( 'category', CATEGORIES, $values['category'], '', 'wpc-log-category' ) . '</p>';
	echo '<p class="wpc-field"><label for="wpc-log-duration">Duration in minutes (optional)</label><input class="wpc-input" type="number" min="1" max="10000" id="wpc-log-duration" name="duration" value="' . esc_attr( $values['duration'] ) . '"></p>';
	echo '</div>';

	echo '<p class="wpc-field"><label for="wpc-log-description">What was done</label><textarea class="wpc-textarea" id="wpc-log-description" name="description" rows="3" required>' . esc_textarea( $values['description'] ) . '</textarea></p>';
	echo '<p class="wpc-field"><label for="wpc-log-notes">Internal notes (optional)</label><textarea class="wpc-textarea" id="wpc-log-notes" name="notes" rows="2">' . esc_textarea( $values['notes'] ) . '</textarea></p>';

	$known_site = $site_id ? $site_id : (int) $values['site_id'];
	if ( $known_site ) {
		render_event_choices( $known_site, $values['events'] );
	} else {
		echo '<p class="wpc-help">To link detected changes, add the record from the website\'s Maintenance tab.</p>';
	}

	echo '<button class="wpc-btn wpc-btn--primary" type="submit">' . ( $log ? 'Save record' : 'Add record' ) . '</button>';
	if ( $log ) {
		echo ' <a class="wpc-btn" href="' . esc_url( current_url( array( 'log' => null, 'edit' => null ) ) ) . '">Cancel</a>';
	}
	echo '</form></section>';
}

function log_actions( $log, $edit_url ) {
	$html  = '<a class="wpc-btn wpc-btn--small" href="' . esc_url( $edit_url ) . '">Edit</a>';
	$html .= button_form( 'wpc_delete_log', 'Delete', array( 'id' => (int) $log->id ), 'wpc-btn wpc-btn--small wpc-btn--danger', 'Delete this maintenance record?' );
	return $html;
}

function render_log_cards( $logs, $links ) {
	foreach ( $logs as $log ) {
		echo '<div class="wpc-log"><div class="wpc-log__head">';
		echo '<span class="wpc-strong">' . esc_html( local_date( $log->performed_at ) ) . '</span>';
		echo '<span>' . avatar( $log->performer_name ) . esc_html( $log->performer_name ) . '</span>';
		echo badge( 'low', CATEGORIES[ $log->category ] ?? $log->category );
		if ( null !== $log->duration_minutes ) {
			echo '<span class="wpc-muted">' . esc_html( $log->duration_minutes . ' min' ) . '</span>';
		}
		echo '<span class="wpc-log__actions">' . log_actions( $log, current_url( array( 'log' => (int) $log->id ) ) ) . '</span></div>';
		echo '<div>' . nl2br( esc_html( $log->description ) ) . '</div>';
		if ( '' !== (string) $log->notes ) {
			echo '<div class="wpc-muted wpc-small">Internal: ' . nl2br( esc_html( $log->notes ) ) . '</div>';
		}
		foreach ( $links[ (int) $log->id ] ?? array() as $event ) {
			echo '<div class="wpc-small wpc-log__link"><span class="dashicons dashicons-admin-links"></span>' . esc_html( $event->name . ' ' . event_change( $event ) ) . '</div>';
		}
		echo '</div>';
	}
}

function render_logs( $logs, $show_site ) {
	if ( empty( $logs ) ) {
		empty_state( 'No maintenance records yet.' );
		return;
	}
	$links = linked_events( $logs );
	if ( ! $show_site ) {
		render_log_cards( $logs, $links );
		return;
	}

	echo '<table class="wpc-table"><thead><tr><th>Performed</th>';
	if ( $show_site ) {
		echo '<th>Website</th>';
	}
	echo '<th>Performed by</th><th>Category</th><th>Work</th><th>Time</th><th>Linked changes</th><th class="wpc-right">Actions</th></tr></thead><tbody>';

	foreach ( $logs as $log ) {
		echo '<tr><td class="wpc-nowrap">' . esc_html( local_date( $log->performed_at ) ) . '</td>';
		if ( $show_site ) {
			echo '<td><a href="' . esc_url( site_url_for( (int) $log->site_id, 'maintenance' ) ) . '">' . esc_html( $log->site_name ? $log->site_name : '—' ) . '</a></td>';
		}
		echo '<td class="wpc-nowrap">' . avatar( $log->performer_name ) . esc_html( $log->performer_name ) . '</td>';
		echo '<td>' . esc_html( CATEGORIES[ $log->category ] ?? $log->category ) . '</td>';
		echo '<td>' . nl2br( esc_html( $log->description ) );
		if ( '' !== (string) $log->notes ) {
			echo '<div class="wpc-muted wpc-small">' . nl2br( esc_html( $log->notes ) ) . '</div>';
		}
		echo '</td><td>' . esc_html( null === $log->duration_minutes ? '—' : $log->duration_minutes . ' min' ) . '</td><td>';
		if ( empty( $links[ (int) $log->id ] ) ) {
			echo '<span class="wpc-muted">—</span>';
		} else {
			foreach ( $links[ (int) $log->id ] as $event ) {
				echo '<div class="wpc-small">' . esc_html( $event->name . ' ' . event_change( $event ) ) . '</div>';
			}
		}
		echo '</td><td class="wpc-right wpc-actions">';
		echo log_actions( $log, page_url( array( 'view' => 'maintenance', 'edit' => (int) $log->id ) ) );
		echo '</td></tr>';
	}
	echo '</tbody></table>';
}

function render_maintenance() {
	$filters = array(
		'site'      => absint( query_arg( 'site_filter' ) ),
		'performer' => absint( query_arg( 'performer' ) ),
		'category'  => isset( CATEGORIES[ query_arg( 'category' ) ] ) ? query_arg( 'category' ) : '',
		'month'     => valid_month( query_arg( 'month' ) ) ? query_arg( 'month' ) : '',
	);
	$edit_id = absint( query_arg( 'edit' ) );
	$log     = $edit_id ? get_log( $edit_id ) : null;

	page_header( 'Maintenance', 'Every documented task, with the person who did it' );
	render_log_form( 0, $log );

	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>Maintenance log</h2></div>';
	echo '<form class="wpc-toolbar" method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '">';
	echo '<input type="hidden" name="page" value="' . esc_attr( PAGE_SLUG ) . '"><input type="hidden" name="view" value="maintenance">';
	echo select_field( 'site_filter', site_options(), $filters['site'] ? (string) $filters['site'] : '', 'All websites' );
	echo select_field( 'performer', performer_options(), $filters['performer'] ? (string) $filters['performer'] : '', 'Everyone' );
	echo select_field( 'category', CATEGORIES, $filters['category'], 'All categories' );
	echo '<input class="wpc-input" type="month" name="month" value="' . esc_attr( $filters['month'] ) . '" aria-label="Month">';
	echo '<button class="wpc-btn" type="submit">Filter</button></form>';
	render_logs( find_logs( $filters, 200 ), true );
	echo '</section>';
}
