<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const URL_ARGS = array( 'view', 'site', 'tab', 'filter', 'search', 'client', 'status', 'paged', 'edit', 'log', 'sub', 'month', 'performer', 'category', 'link', 'site_filter', 'undocumented' );

function query_arg( $key ) {
	return isset( $_GET[ $key ] ) ? sanitize_text_field( wp_unslash( $_GET[ $key ] ) ) : '';
}

function current_args() {
	$args = array();
	foreach ( URL_ARGS as $key ) {
		$value = query_arg( $key );
		if ( '' !== $value ) {
			$args[ $key ] = $value;
		}
	}
	return $args;
}

function current_url( $changes = array() ) {
	$args = array_merge( current_args(), $changes );
	foreach ( $args as $key => $value ) {
		if ( null === $value || '' === $value ) {
			unset( $args[ $key ] );
		}
	}
	return page_url( $args );
}

function site_url_for( $site_id, $tab = 'overview' ) {
	$view = query_arg( 'view' );
	return page_url(
		array(
			'view' => '' === $view ? 'overview' : $view,
			'site' => $site_id,
			'tab'  => $tab,
		)
	);
}

function badge( $tone, $label ) {
	return '<span class="wpc-badge wpc-badge--' . esc_attr( $tone ) . '"><span class="wpc-dot"></span>' . esc_html( $label ) . '</span>';
}

function status_badge( $status ) {
	$label = STATUS_LABELS[ $status ] ?? ucfirst( (string) $status );
	return badge( $status, $label );
}

function severity_badge( $severity ) {
	$labels = array(
		'critical' => 'Critical',
		'moderate' => 'Moderate',
		'low'      => 'Low',
		'ok'       => 'OK',
	);
	return badge( $severity, $labels[ $severity ] ?? $severity );
}

function update_badge( $component ) {
	if ( 'yes' === $component->update_state ) {
		return badge( 'moderate', 'Update to ' . $component->update_version );
	}
	if ( 'no' === $component->update_state ) {
		return badge( 'ok', 'Up to date' );
	}
	return badge( 'pending', 'Unknown' );
}

function backup_badge( $gmt ) {
	if ( empty( $gmt ) ) {
		return badge( 'pending', 'Unknown' );
	}
	$days     = days_since( $gmt );
	$settings = settings();
	$tone     = 'ok';
	if ( $days > (int) $settings['backup_critical_days'] ) {
		$tone = 'critical';
	} elseif ( $days > (int) $settings['backup_warning_days'] ) {
		$tone = 'moderate';
	}
	return badge( $tone, time_ago( $gmt ) );
}

function updates_badge( $count ) {
	if ( (int) $count > 0 ) {
		return badge( 'moderate', (string) (int) $count );
	}
	return badge( 'ok', 'Up to date' );
}

function type_label( $type ) {
	$labels = array(
		'core'     => 'Core',
		'plugin'   => 'Plugin',
		'must-use' => 'Must-use',
		'drop-in'  => 'Drop-in',
		'theme'    => 'Theme',
	);
	return $labels[ $type ] ?? $type;
}

function event_label( $event ) {
	$labels = array(
		'installed'   => 'Installed',
		'removed'     => 'Removed',
		'updated'     => 'Updated',
		'downgraded'  => 'Downgraded',
		'activated'   => 'Activated',
		'deactivated' => 'Deactivated',
	);
	return $labels[ $event ] ?? $event;
}

function event_change( $event ) {
	if ( 'updated' === $event->event || 'downgraded' === $event->event ) {
		return $event->old_value . ' → ' . $event->new_value;
	}
	if ( 'installed' === $event->event ) {
		return 'version ' . $event->new_value;
	}
	if ( 'removed' === $event->event ) {
		return 'was ' . $event->old_value;
	}
	return $event->old_value . ' → ' . $event->new_value;
}

function avatar( $name ) {
	$letter = strtoupper( mb_substr( trim( (string) $name ), 0, 1 ) );
	return '<span class="wpc-avatar">' . esc_html( '' === $letter ? '?' : $letter ) . '</span>';
}

function documented_by( $event, $documentation ) {
	if ( ! empty( $documentation[ (int) $event->id ] ) ) {
		$names = array();
		foreach ( $documentation[ (int) $event->id ] as $row ) {
			$names[] = avatar( $row->performer_name ) . esc_html( $row->performer_name );
		}
		return implode( '<br>', array_unique( $names ) );
	}
	$text = '<span class="wpc-muted">Not documented</span>';
	if ( ! empty( $event->auto_update ) ) {
		$text .= '<br><span class="wpc-muted wpc-small">auto-updates are on</span>';
	}
	return $text;
}

function stat_card( $label, $value, $icon, $tone, $extra = '' ) {
	echo '<div class="wpc-card wpc-card--' . esc_attr( $tone ) . '">';
	echo '<div class="wpc-card__label">' . esc_html( $label ) . '</div>';
	echo '<div class="wpc-card__row"><span class="wpc-card__value">' . esc_html( (string) $value ) . '</span>';
	if ( '' !== $extra ) {
		echo '<span class="wpc-card__extra">' . esc_html( $extra ) . '</span>';
	}
	echo '<span class="dashicons ' . esc_attr( $icon ) . ' wpc-card__icon"></span></div></div>';
}

function page_header( $title, $subtitle, $actions = '' ) {
	echo '<div class="wpc-header"><div><h1 class="wpc-title">' . esc_html( $title ) . '</h1>';
	if ( '' !== $subtitle ) {
		echo '<p class="wpc-subtitle">' . esc_html( $subtitle ) . '</p>';
	}
	echo '</div>';
	if ( '' !== $actions ) {
		echo '<div class="wpc-header__actions">' . $actions . '</div>';
	}
	echo '</div>';
}

function form_open( $action, $class = '', $confirm = '' ) {
	$html  = '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"';
	$html .= '' !== $class ? ' class="' . esc_attr( $class ) . '"' : '';
	$html .= '' !== $confirm ? ' data-wpc-confirm="' . esc_attr( $confirm ) . '"' : '';
	$html .= '>';
	$html .= '<input type="hidden" name="action" value="' . esc_attr( $action ) . '">';
	$html .= wp_nonce_field( $action, '_wpnonce', true, false );
	$html .= '<input type="hidden" name="redirect_to" value="' . esc_attr( current_url() ) . '">';
	return $html;
}

function button_form( $action, $label, $fields = array(), $class = 'wpc-btn', $confirm = '' ) {
	$html = form_open( $action, 'wpc-inline', $confirm );
	foreach ( $fields as $name => $value ) {
		$html .= '<input type="hidden" name="' . esc_attr( $name ) . '" value="' . esc_attr( (string) $value ) . '">';
	}
	$html .= '<button type="submit" class="' . esc_attr( $class ) . '">' . esc_html( $label ) . '</button></form>';
	return $html;
}

function select_field( $name, $options, $selected, $placeholder = '', $id = '' ) {
	$id   = '' === $id ? 'wpc-' . $name : $id;
	$html = '<select class="wpc-select" name="' . esc_attr( $name ) . '" id="' . esc_attr( $id ) . '">';
	if ( '' !== $placeholder ) {
		$html .= '<option value="">' . esc_html( $placeholder ) . '</option>';
	}
	foreach ( $options as $value => $label ) {
		$html .= '<option value="' . esc_attr( (string) $value ) . '"' . selected( (string) $selected, (string) $value, false ) . '>' . esc_html( $label ) . '</option>';
	}
	return $html . '</select>';
}

function client_options() {
	$options = array();
	foreach ( get_clients() as $client ) {
		$options[ (int) $client->id ] = $client->name;
	}
	return $options;
}

function site_options() {
	$options = array();
	foreach ( all_sites() as $site ) {
		$options[ (int) $site->id ] = $site->name;
	}
	return $options;
}

function performer_options() {
	$options = array();
	foreach ( performers() as $user ) {
		$options[ (int) $user->ID ] = $user->display_name;
	}
	return $options;
}

function empty_state( $text ) {
	echo '<div class="wpc-empty">' . esc_html( $text ) . '</div>';
}

function pagination( $total, $page, $per_page ) {
	$pages = (int) ceil( $total / $per_page );
	$first = $total > 0 ? ( $page - 1 ) * $per_page + 1 : 0;
	$last  = min( $total, $page * $per_page );
	echo '<div class="wpc-pagination"><div class="wpc-pages">';
	for ( $number = 1; $number <= $pages; $number++ ) {
		$class = $number === $page ? 'wpc-page is-active' : 'wpc-page';
		echo '<a class="' . esc_attr( $class ) . '" href="' . esc_url( current_url( array( 'paged' => $number ) ) ) . '">' . (int) $number . '</a>';
	}
	echo '</div><div class="wpc-muted">' . (int) $first . '–' . (int) $last . ' of ' . (int) $total . '</div></div>';
}

function render_notices() {
	foreach ( take_notices() as $notice ) {
		$type = in_array( $notice['type'], array( 'success', 'error', 'warning' ), true ) ? $notice['type'] : 'warning';
		echo '<div class="wpc-notice wpc-notice--' . esc_attr( $type ) . '">' . esc_html( $notice['message'] ) . '</div>';
	}
}

function site_name_cell( $site ) {
	$html  = '<a class="wpc-site-name" href="' . esc_url( site_url_for( (int) $site->id ) ) . '">' . esc_html( $site->name ) . '</a>';
	$html .= ' <a class="wpc-external" href="' . esc_url( $site->url ) . '" target="_blank" rel="noopener noreferrer" title="Open the website"><span class="dashicons dashicons-external"></span></a>';
	$html .= '<div class="wpc-muted wpc-small">' . esc_html( preg_replace( '#^https?://#', '', $site->url ) ) . '</div>';
	return $html;
}

function sites_table( $rows, $with_actions ) {
	if ( empty( $rows ) ) {
		empty_state( 'No websites match. Add a website under Websites.' );
		return;
	}
	echo '<table class="wpc-table"><thead><tr>';
	if ( ! $with_actions ) {
		echo '<th class="wpc-check"><input type="checkbox" data-wpc-select-all aria-label="Select all"></th>';
	}
	echo '<th>Website</th><th>Client</th><th>Status</th><th>Updates</th><th>Backup</th><th>PHP</th><th>Last sync</th>';
	if ( $with_actions ) {
		echo '<th class="wpc-right">Actions</th>';
	}
	echo '</tr></thead><tbody>';

	foreach ( $rows as $site ) {
		echo '<tr>';
		if ( ! $with_actions ) {
			echo '<td class="wpc-check"><input type="checkbox" name="sites[]" value="' . (int) $site->id . '" aria-label="Select ' . esc_attr( $site->name ) . '"></td>';
		}
		echo '<td>' . site_name_cell( $site ) . '</td>';
		echo '<td>' . esc_html( $site->client_name ? $site->client_name : '—' ) . '</td>';
		echo '<td>' . status_badge( $site->status ) . '</td>';
		echo '<td>' . ( empty( $site->last_sync_at ) ? '—' : updates_badge( $site->pending_updates ) ) . '</td>';
		echo '<td>' . backup_badge( $site->last_backup_at ) . '</td>';
		echo '<td>' . esc_html( '' === $site->php_version ? '—' : $site->php_version ) . '</td>';
		echo '<td>' . esc_html( time_ago( $site->last_sync_at ) ) . '</td>';
		if ( $with_actions ) {
			echo '<td class="wpc-right wpc-actions">';
			echo button_form( 'wpc_sync_site', 'Sync', array( 'site_id' => (int) $site->id ), 'wpc-btn wpc-btn--small' );
			echo '<a class="wpc-btn wpc-btn--small" href="' . esc_url( page_url( array( 'view' => 'websites', 'edit' => (int) $site->id ) ) ) . '">Edit</a>';
			echo button_form( 'wpc_delete_site', 'Delete', array( 'id' => (int) $site->id ), 'wpc-btn wpc-btn--small wpc-btn--danger', 'Delete ' . $site->name . ' and all its history from WP Control? The website itself is not changed.' );
			echo '</td>';
		}
		echo '</tr>';
	}
	echo '</tbody></table>';
}
