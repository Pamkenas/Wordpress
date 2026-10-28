<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function render_settings() {
	$settings = settings();
	$next     = wp_next_scheduled( SYNC_HOOK );

	page_header( 'Settings', 'How WP Control syncs and judges the websites' );
	echo '<section class="wpc-panel">';
	echo form_open( 'wpc_save_settings', 'wpc-form' );
	echo '<div class="wpc-grid-2">';
	echo '<p class="wpc-field"><label for="wpc-frequency">Automatic sync</label>' . select_field( 'frequency', FREQUENCIES, $settings['frequency'], '', 'wpc-frequency' ) . '</p>';
	echo '<p class="wpc-field"><label for="wpc-min-php">Oldest PHP version that is still OK</label><input class="wpc-input" id="wpc-min-php" name="min_php" value="' . esc_attr( $settings['min_php'] ) . '" pattern="\d+\.\d+"></p>';
	echo '<p class="wpc-field"><label for="wpc-warning">Backup warning after (days)</label><input class="wpc-input" type="number" min="1" max="90" id="wpc-warning" name="backup_warning_days" value="' . (int) $settings['backup_warning_days'] . '"></p>';
	echo '<p class="wpc-field"><label for="wpc-critical">Backup critical after (days)</label><input class="wpc-input" type="number" min="2" max="365" id="wpc-critical" name="backup_critical_days" value="' . (int) $settings['backup_critical_days'] . '"></p>';
	echo '<p class="wpc-field"><label for="wpc-delimiter">CSV separator</label>' . select_field(
		'csv_delimiter',
		array(
			','  => 'Comma (,)',
			';'  => 'Semicolon (;) for Slovenian Excel',
		),
		$settings['csv_delimiter'],
		'',
		'wpc-delimiter'
	) . '</p>';
	echo '</div>';
	echo '<button class="wpc-btn wpc-btn--primary" type="submit">Save settings</button>';
	echo '</form>';
	if ( $next ) {
		echo '<p class="wpc-help">Next automatic sync: ' . esc_html( local_date( gmt_from_timestamp( $next ) ) ) . '. WordPress runs it when someone visits this site.</p>';
	} else {
		echo '<p class="wpc-help">Automatic sync is off. Use the Sync buttons.</p>';
	}
	echo '</section>';

	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>About</h2></div>';
	key_values(
		array(
			'WP Control Manager' => esc_html( VERSION ),
			'Newest agent'       => esc_html( LATEST_AGENT_VERSION ),
			'Access'             => esc_html( 'Users with the manage_wp_control capability (administrators)' ),
		)
	);
	echo '</section>';
}
