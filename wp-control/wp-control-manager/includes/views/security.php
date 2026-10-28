<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function render_security() {
	$issues = open_issues();
	$counts = array(
		'critical' => 0,
		'moderate' => 0,
		'low'      => 0,
	);
	foreach ( $issues as $issue ) {
		if ( isset( $counts[ $issue->severity ] ) ) {
			++$counts[ $issue->severity ];
		}
	}

	page_header( 'Security', 'Open findings of the basic checks on all websites' );
	echo '<div class="wpc-cards wpc-cards--3">';
	stat_card( 'Critical', $counts['critical'], 'dashicons-warning', 'red' );
	stat_card( 'Moderate', $counts['moderate'], 'dashicons-flag', 'yellow' );
	stat_card( 'Low', $counts['low'], 'dashicons-info-outline', 'blue' );
	echo '</div>';

	echo '<section class="wpc-panel">';
	if ( empty( $issues ) ) {
		empty_state( 'No open findings.' );
		echo '</section>';
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>Website</th><th>Finding</th><th>Severity</th></tr></thead><tbody>';
	foreach ( $issues as $issue ) {
		echo '<tr><td><a href="' . esc_url( site_url_for( (int) $issue->site_id, 'security' ) ) . '">' . esc_html( $issue->site_name ) . '</a></td>';
		echo '<td>' . esc_html( $issue->title ) . '<div class="wpc-muted wpc-small">' . esc_html( $issue->detail ) . '</div></td>';
		echo '<td>' . severity_badge( $issue->severity ) . '</td></tr>';
	}
	echo '</tbody></table>';
	echo '<p class="wpc-help">These are configuration checks (updates, PHP, HTTPS, debug mode, file editor, backups). Scanning for known vulnerabilities is planned for a later version.</p>';
	echo '</section>';
}
