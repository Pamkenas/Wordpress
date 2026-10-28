<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function render_client_form( $client ) {
	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>' . ( $client ? 'Edit client' : 'Add client' ) . '</h2>';
	if ( $client ) {
		echo '<a class="wpc-btn wpc-btn--small" href="' . esc_url( page_url( array( 'view' => 'clients' ) ) ) . '">Cancel</a>';
	}
	echo '</div>';
	echo form_open( 'wpc_save_client', 'wpc-form' );
	echo '<input type="hidden" name="id" value="' . (int) ( $client ? $client->id : 0 ) . '">';
	echo '<div class="wpc-grid-2">';
	echo '<p class="wpc-field"><label for="wpc-client-name">Client name</label><input class="wpc-input" id="wpc-client-name" name="name" required maxlength="190" value="' . esc_attr( $client ? $client->name : '' ) . '"></p>';
	echo '<p class="wpc-field"><label for="wpc-client-email">Contact e-mail (optional)</label><input class="wpc-input" type="email" id="wpc-client-email" name="email" value="' . esc_attr( $client ? $client->contact_email : '' ) . '"></p>';
	echo '</div>';
	echo '<p class="wpc-field"><label for="wpc-client-notes">Notes (optional)</label><textarea class="wpc-textarea" id="wpc-client-notes" name="notes" rows="2">' . esc_textarea( $client ? (string) $client->notes : '' ) . '</textarea></p>';
	echo '<button class="wpc-btn wpc-btn--primary" type="submit">' . ( $client ? 'Save client' : 'Add client' ) . '</button>';
	echo '</form></section>';
}

function render_clients() {
	$edit_id = absint( query_arg( 'edit' ) );
	$client  = $edit_id ? get_client( $edit_id ) : null;
	$clients = get_clients();

	page_header( 'Clients', 'The companies whose websites you maintain' );
	render_client_form( $client );

	echo '<section class="wpc-panel"><div class="wpc-panel__header"><h2>All clients</h2></div>';
	if ( empty( $clients ) ) {
		empty_state( 'No clients yet.' );
		echo '</section>';
		return;
	}
	echo '<table class="wpc-table"><thead><tr><th>Client</th><th>Contact</th><th>Websites</th><th>Notes</th><th class="wpc-right">Actions</th></tr></thead><tbody>';
	foreach ( $clients as $row ) {
		echo '<tr><td class="wpc-strong">' . esc_html( $row->name ) . '</td>';
		echo '<td>' . ( '' === $row->contact_email ? '—' : '<a href="mailto:' . esc_attr( $row->contact_email ) . '">' . esc_html( $row->contact_email ) . '</a>' ) . '</td>';
		echo '<td><a href="' . esc_url( page_url( array( 'view' => 'overview', 'client' => (int) $row->id ) ) ) . '">' . (int) $row->site_count . '</a></td>';
		echo '<td class="wpc-muted">' . esc_html( mb_substr( (string) $row->notes, 0, 80 ) ) . '</td>';
		echo '<td class="wpc-right wpc-actions"><a class="wpc-btn wpc-btn--small" href="' . esc_url( page_url( array( 'view' => 'clients', 'edit' => (int) $row->id ) ) ) . '">Edit</a>';
		echo button_form( 'wpc_delete_client', 'Delete', array( 'id' => (int) $row->id ), 'wpc-btn wpc-btn--small wpc-btn--danger', 'Delete the client ' . $row->name . '?' );
		echo '</td></tr>';
	}
	echo '</tbody></table></section>';
}
