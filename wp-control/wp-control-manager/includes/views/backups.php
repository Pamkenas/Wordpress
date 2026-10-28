<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function render_backups() {
	$sites   = find_sites( array(), 1, 1000 );
	$latest  = latest_backups();
	$warning = (int) settings()['backup_warning_days'];

	page_header( 'Backups', 'The newest backup of every website. Older than ' . $warning . ' days is shown in yellow.' );
	echo '<section class="wpc-panel">';
	if ( empty( $sites['rows'] ) ) {
		empty_state( 'No websites yet.' );
		echo '</section>';
		return;
	}

	echo '<table class="wpc-table"><thead><tr><th>Website</th><th>Client</th><th>Last backup</th><th>Date</th><th>Made with</th><th>Status</th></tr></thead><tbody>';
	foreach ( $sites['rows'] as $site ) {
		$backup = $latest[ (int) $site->id ] ?? null;
		echo '<tr><td>' . site_name_cell( $site ) . '</td>';
		echo '<td>' . esc_html( $site->client_name ? $site->client_name : '—' ) . '</td>';
		echo '<td>' . backup_badge( $site->last_backup_at ) . '</td>';
		echo '<td>' . esc_html( local_date( $site->last_backup_at ) ) . '</td>';
		echo '<td>' . esc_html( $backup ? $backup->source : '—' ) . '</td>';
		if ( ! $backup ) {
			echo '<td>' . badge( 'pending', 'Unknown' ) . '</td></tr>';
			continue;
		}
		echo '<td>' . ( 'success' === $backup->status ? badge( 'ok', 'Success' ) : badge( 'critical', 'Failed' ) ) . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">WP Control reads backups made with UpdraftPlus. Running a backup from here is planned for a later version.</p>';
	echo '</section>';
}
