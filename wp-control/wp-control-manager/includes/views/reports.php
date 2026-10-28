<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function render_reports() {
	page_header( 'Reports', 'Download the data as CSV files for Excel' );
	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>CSV export</h2></div>';
	echo form_open( 'wpc_export', 'wpc-form' );
	echo '<div class="wpc-grid-2">';
	echo '<p class="wpc-field"><label for="wpc-export-type">What</label>' . select_field( 'type', EXPORTS, 'websites', '', 'wpc-export-type' ) . '</p>';
	echo '<p class="wpc-field"><label for="wpc-export-site">Website</label>' . select_field( 'site', site_options(), '', 'All websites', 'wpc-export-site' ) . '</p>';
	echo '<p class="wpc-field"><label for="wpc-export-month">Month (for changes and maintenance)</label><input class="wpc-input" type="month" id="wpc-export-month" name="month"></p>';
	echo '</div>';
	echo '<button class="wpc-btn wpc-btn--primary" type="submit">Download CSV</button>';
	echo '</form>';
	echo '<p class="wpc-help">The files contain client data. Keep them inside the agency. Every download is recorded in Activity → Audit history.</p>';
	echo '</section>';
}
