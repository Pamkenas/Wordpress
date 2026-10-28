<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function render_site_form( $site ) {
	$old   = old_input( 'site' );
	$id    = $site ? (int) $site->id : 0;
	$agent = $site ? get_agent_row( $id ) : null;

	if ( ! empty( $old ) && (int) ( $old['id'] ?? 0 ) !== $id ) {
		$old = array();
	}
	$name      = $old['name'] ?? ( $site ? $site->name : '' );
	$url       = $old['url'] ?? ( $site ? $site->url : '' );
	$client_id = $old['client_id'] ?? ( $site ? (int) $site->client_id : 0 );
	$key       = empty( $old['connection_key'] ) ? '' : decrypt_secret( $old['connection_key'] );

	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>' . ( $site ? 'Edit website' : 'Add website' ) . '</h2>';
	if ( $site ) {
		echo '<a class="wpc-btn wpc-btn--small" href="' . esc_url( page_url( array( 'view' => 'websites' ) ) ) . '">Cancel</a>';
	}
	echo '</div>';

	echo form_open( 'wpc_save_site', 'wpc-form' );
	echo '<input type="hidden" name="id" value="' . (int) $id . '">';
	echo '<div class="wpc-grid-2">';
	echo '<p class="wpc-field"><label for="wpc-site-name">Name</label><input class="wpc-input" id="wpc-site-name" name="name" maxlength="190" value="' . esc_attr( $name ) . '" placeholder="studio-alpha.si"></p>';
	echo '<p class="wpc-field"><label for="wpc-site-url">Website address</label><input class="wpc-input" id="wpc-site-url" name="url" required value="' . esc_attr( $url ) . '" placeholder="https://www.example.com"></p>';
	echo '<p class="wpc-field"><label for="wpc-site-client">Client</label>' . select_field( 'client_id', client_options(), $client_id ? (string) $client_id : '', 'No client', 'wpc-site-client' ) . '</p>';

	$placeholder = $agent ? 'Leave empty to keep the current key (ending in ' . $agent->key_hint . ')' : 'wpc1-…';
	echo '<p class="wpc-field"><label for="wpc-site-key">Connection key</label><input class="wpc-input wpc-code" id="wpc-site-key" name="connection_key" autocomplete="off" spellcheck="false" value="' . esc_attr( $key ) . '" placeholder="' . esc_attr( $placeholder ) . '"' . ( $site ? '' : ' required' ) . '></p>';
	echo '</div>';
	echo '<p class="wpc-help">On the client site: install and activate <strong>WP Control Agent</strong>, open <strong>WP Control → Connection</strong> and click <strong>Create connection key</strong>. Copy the key here. WP Control reads the site at once.</p>';
	echo '<button class="wpc-btn wpc-btn--primary" type="submit">' . ( $site ? 'Save website' : 'Add website' ) . '</button>';
	echo '</form></section>';
}

function render_websites() {
	$edit_id = absint( query_arg( 'edit' ) );
	$editing = $edit_id ? get_site_row( $edit_id ) : null;
	$filters = site_filters();
	$page    = max( 1, absint( query_arg( 'paged' ) ) );
	$result  = find_sites( $filters, $page, 20 );

	page_header( 'Websites', 'Add, edit or remove the websites that WP Control watches' );
	render_site_form( $editing );

	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>All websites</h2></div>';
	render_site_filters( 'websites', $filters );
	sites_table( $result['rows'], true );
	pagination( $result['total'], $page, 20 );
	echo '</section>';
}
