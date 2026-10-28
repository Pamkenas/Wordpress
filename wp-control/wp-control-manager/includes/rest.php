<?php

namespace WPControlManager;

use WP_Error;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

const API_NAMESPACE = 'wp-control/v1';

function register_api() {
	register_rest_route(
		API_NAMESPACE,
		'/sites',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => __NAMESPACE__ . '\api_sites',
			'permission_callback' => __NAMESPACE__ . '\api_allowed',
		)
	);
	register_rest_route(
		API_NAMESPACE,
		'/sites/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => __NAMESPACE__ . '\api_site',
			'permission_callback' => __NAMESPACE__ . '\api_allowed',
			'args'                => array(
				'id' => array(
					'sanitize_callback' => 'absint',
				),
			),
		)
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\register_api' );

function api_allowed() {
	return current_user_can( CAPABILITY );
}

function api_date( $gmt ) {
	return empty( $gmt ) ? null : gmdate( 'c', timestamp_from_gmt( $gmt ) );
}

function api_site_summary( $site ) {
	return array(
		'id'             => (int) $site->id,
		'name'           => $site->name,
		'url'            => $site->url,
		'client'         => $site->client_name ? $site->client_name : null,
		'status'         => $site->status,
		'wordpress'      => $site->wp_version,
		'php'            => $site->php_version,
		'pendingUpdates' => (int) $site->pending_updates,
		'unknownUpdates' => (int) $site->unknown_updates,
		'criticalIssues' => (int) $site->critical_issues,
		'lastBackupAt'   => api_date( $site->last_backup_at ),
		'lastSyncAt'     => api_date( $site->last_sync_at ),
		'lastError'      => '' === (string) $site->last_error ? null : $site->last_error,
	);
}

function api_sites() {
	$result = find_sites( array(), 1, 1000 );
	$list   = array();
	foreach ( $result['rows'] as $site ) {
		$list[] = api_site_summary( $site );
	}
	return rest_ensure_response( $list );
}

function api_site( $request ) {
	$site = get_site_row( (int) $request['id'] );
	if ( ! $site ) {
		return new WP_Error( 'wpc_not_found', 'Website not found.', array( 'status' => 404 ) );
	}

	$data               = api_site_summary( $site );
	$data['components'] = array();
	foreach ( site_components( (int) $site->id ) as $item ) {
		$data['components'][] = array(
			'type'            => $item->type,
			'identifier'      => $item->slug,
			'name'            => $item->name,
			'version'         => $item->version,
			'status'          => $item->status,
			'updateAvailable' => $item->update_state,
			'newVersion'      => '' === $item->update_version ? null : $item->update_version,
		);
	}
	$data['checks'] = array();
	foreach ( site_checks( (int) $site->id ) as $item ) {
		$data['checks'][] = array(
			'check'    => $item->check_key,
			'severity' => $item->severity,
			'title'    => $item->title,
			'detail'   => $item->detail,
		);
	}
	return rest_ensure_response( $data );
}
