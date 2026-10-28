<?php

namespace WPControlManager;

use WP_Error;

defined( 'ABSPATH' ) || exit;

const AGENT_ERRORS = array(
	'wpc_not_connected' => 'WP Control Agent on this site has no connection key. Create one on the site (WP Control → Connection) and enter it under Edit website.',
	'wpc_bad_signature' => 'The connection key is wrong. Create a new key on the site and enter it under Edit website.',
	'wpc_clock'         => 'The clocks of this server and the site differ by more than 5 minutes. Fix the server time.',
	'wpc_replay'        => 'The site refused a repeated request. Sync again.',
	'wpc_unsigned'      => 'The site did not receive the signature. A proxy or security plugin may remove the X-WPC headers.',
);

function agent_url( $site_url ) {
	return add_query_arg( 'rest_route', AGENT_ROUTE, trailingslashit( $site_url ) );
}

function sync_error( $site_status, $message ) {
	return new WP_Error( 'wpc_sync', $message, array( 'site_status' => $site_status ) );
}

function http_error_message( $code, $data ) {
	$error_code = is_array( $data ) && isset( $data['code'] ) && is_string( $data['code'] ) ? $data['code'] : '';
	if ( isset( AGENT_ERRORS[ $error_code ] ) ) {
		return AGENT_ERRORS[ $error_code ];
	}
	if ( 404 === $code && 'rest_no_route' === $error_code ) {
		return 'WP Control Agent is not installed or not active on this site.';
	}
	if ( 404 === $code ) {
		return 'There is no WordPress at this address (HTTP 404). Check the website address.';
	}
	if ( 401 === $code || 403 === $code ) {
		return 'The site blocked the request (HTTP ' . $code . '). A security plugin may block the REST API; allow /wp-control-agent/v1/ in its settings.';
	}
	if ( 429 === $code ) {
		return 'The site limits requests (HTTP 429). Try again later.';
	}
	if ( $code >= 500 ) {
		return 'The site had a server error (HTTP ' . $code . ').';
	}
	return 'The site answered with HTTP ' . $code . '.';
}

function is_text_list( $value ) {
	if ( ! is_array( $value ) ) {
		return false;
	}
	foreach ( $value as $item ) {
		if ( ! is_string( $item ) ) {
			return false;
		}
	}
	return true;
}

function has_text_keys( $item, $keys ) {
	if ( ! is_array( $item ) ) {
		return false;
	}
	foreach ( $keys as $key ) {
		if ( ! isset( $item[ $key ] ) || ! is_string( $item[ $key ] ) ) {
			return false;
		}
	}
	return true;
}

function valid_transient( $data ) {
	return is_array( $data )
		&& isset( $data['checked'] ) && is_bool( $data['checked'] )
		&& isset( $data['updates'], $data['checkedVersions'] ) && is_array( $data['updates'] ) && is_array( $data['checkedVersions'] )
		&& isset( $data['noUpdate'] ) && is_text_list( $data['noUpdate'] );
}

function valid_snapshot( $data ) {
	if ( ! is_array( $data ) || 1 !== ( $data['schema'] ?? null ) ) {
		return false;
	}
	foreach ( array( 'site', 'core', 'plugins', 'themes', 'backup' ) as $key ) {
		if ( ! isset( $data[ $key ] ) || ! is_array( $data[ $key ] ) ) {
			return false;
		}
	}
	if ( ! has_text_keys( $data['site'], array( 'url', 'php' ) ) || ! has_text_keys( $data['core'], array( 'version' ) ) ) {
		return false;
	}
	if ( ! valid_transient( $data['pluginUpdates'] ?? null ) || ! valid_transient( $data['themeUpdates'] ?? null ) ) {
		return false;
	}
	foreach ( $data['plugins'] as $plugin ) {
		if ( ! has_text_keys( $plugin, array( 'file', 'name', 'version', 'kind' ) ) ) {
			return false;
		}
	}
	foreach ( $data['themes'] as $theme ) {
		if ( ! has_text_keys( $theme, array( 'slug', 'name', 'version' ) ) ) {
			return false;
		}
	}
	return true;
}

function fetch_snapshot( $site_url, $secret ) {
	$timestamp = (string) time();
	$nonce     = bin2hex( random_bytes( 16 ) );
	$response  = wp_remote_get(
		agent_url( $site_url ),
		array(
			'timeout'             => 20,
			'redirection'         => 0,
			'limit_response_size' => 5 * MB_IN_BYTES,
			'headers'             => array(
				'Accept'          => 'application/json',
				'Cache-Control'   => 'no-cache',
				'X-WPC-Timestamp' => $timestamp,
				'X-WPC-Nonce'     => $nonce,
				'X-WPC-Signature' => request_signature( $secret, 'GET', AGENT_ROUTE, $timestamp, $nonce ),
				'X-WPC-Manager'   => home_url(),
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		return sync_error( 'offline', 'The site could not be reached: ' . clean_text( $response->get_error_message(), 200 ) );
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );

	if ( $code >= 300 && $code < 400 ) {
		$location = clean_text( wp_remote_retrieve_header( $response, 'location' ), 200 );
		return sync_error( 'error', 'The site redirected to ' . $location . '. Use that address for the website.' );
	}
	if ( 200 !== $code ) {
		$status = $code >= 500 ? 'offline' : 'error';
		return sync_error( $status, http_error_message( $code, $data ) );
	}
	if ( ! is_array( $data ) || ! isset( $data['payload'], $data['signature'] ) || ! is_string( $data['payload'] ) || ! is_string( $data['signature'] ) ) {
		return sync_error( 'error', 'The site did not answer like WP Control Agent. Is the agent installed and active?' );
	}
	if ( ! hash_equals( response_signature( $secret, $nonce, $data['payload'] ), $data['signature'] ) ) {
		return sync_error( 'error', 'The answer was not signed with this connection key, so it was ignored.' );
	}

	$snapshot = json_decode( $data['payload'], true );
	if ( ! valid_snapshot( $snapshot ) ) {
		return sync_error( 'error', 'The site sent data in an unknown format. Update WP Control Agent on the site.' );
	}
	return $snapshot;
}
