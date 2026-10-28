<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function site_filters() {
	$status = sanitize_key( query_arg( 'status' ) );
	return array(
		'search' => query_arg( 'search' ),
		'client' => absint( query_arg( 'client' ) ),
		'status' => isset( STATUS_LABELS[ $status ] ) ? $status : '',
	);
}

function render_site_filters( $view, $filters ) {
	echo '<form class="wpc-toolbar" method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '">';
	echo '<input type="hidden" name="page" value="' . esc_attr( PAGE_SLUG ) . '">';
	echo '<input type="hidden" name="view" value="' . esc_attr( $view ) . '">';
	echo '<label class="screen-reader-text" for="wpc-search">Search websites</label>';
	echo '<input class="wpc-input wpc-search" id="wpc-search" type="search" name="search" placeholder="Search websites, clients…" value="' . esc_attr( $filters['search'] ) . '">';
	echo '<label class="screen-reader-text" for="wpc-client">Client</label>';
	echo select_field( 'client', client_options(), $filters['client'] ? (string) $filters['client'] : '', 'All clients' );
	echo '<label class="screen-reader-text" for="wpc-status">Status</label>';
	echo select_field( 'status', STATUS_LABELS, $filters['status'], 'All status' );
	echo '<button class="wpc-btn" type="submit">Filter</button>';
	echo '</form>';
}

function render_overview() {
	$stats   = overview_stats();
	$filters = site_filters();
	$page    = max( 1, absint( query_arg( 'paged' ) ) );
	$result  = find_sites( $filters, $page, 20 );
	$online  = $stats['total'] > 0 ? round( 100 * $stats['online'] / $stats['total'] ) . '%' : '';

	page_header(
		'Overview',
		'Your WordPress websites at a glance',
		button_form( 'wpc_sync_all', 'Sync all now', array(), 'wpc-btn wpc-btn--primary' )
	);

	echo '<div class="wpc-cards">';
	stat_card( 'Total websites', $stats['total'], 'dashicons-admin-site-alt3', 'blue' );
	stat_card( 'Online', $stats['online'], 'dashicons-yes-alt', 'green', $online );
	stat_card( 'Pending updates', $stats['updates'], 'dashicons-update', 'yellow' );
	stat_card( 'Critical issues', $stats['critical'], 'dashicons-warning', 'red' );
	echo '</div>';

	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>Websites</h2></div>';
	render_site_filters( 'overview', $filters );

	echo form_open( 'wpc_sync_selected' );
	sites_table( $result['rows'], false );
	if ( ! empty( $result['rows'] ) ) {
		echo '<div class="wpc-table-actions"><button class="wpc-btn" type="submit">Sync selected</button></div>';
	}
	echo '</form>';
	pagination( $result['total'], $page, 20 );
	echo '</section>';
}
