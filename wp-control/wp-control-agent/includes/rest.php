<?php

namespace WPControlAgent;

use WP_Error;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

function register_routes() {
	register_rest_route(
		REST_NAMESPACE,
		'/snapshot',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => __NAMESPACE__ . '\send_snapshot',
			'permission_callback' => __NAMESPACE__ . '\check_signature',
			'args'                => array(),
		)
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\register_routes' );

function refuse( $code, $message, $extra = array() ) {
	return new WP_Error( $code, $message, array_merge( array( 'status' => 401 ), $extra ) );
}

function check_signature( $request ) {
	$secret = (string) get_option( SECRET_OPTION, '' );
	if ( '' === $secret ) {
		return refuse( 'wpc_not_connected', 'This site has no WP Control connection key.' );
	}

	$timestamp = (string) $request->get_header( 'X-WPC-Timestamp' );
	$nonce     = (string) $request->get_header( 'X-WPC-Nonce' );
	$signature = (string) $request->get_header( 'X-WPC-Signature' );
	if ( ! ctype_digit( $timestamp ) || ! preg_match( '/^[a-f0-9]{32}$/', $nonce ) || ! preg_match( '/^[a-f0-9]{64}$/', $signature ) ) {
		return refuse( 'wpc_unsigned', 'The request is not signed.' );
	}

	if ( abs( time() - (int) $timestamp ) > MAX_CLOCK_SKEW ) {
		return refuse( 'wpc_clock', 'The request is too old or the clocks differ.', array( 'serverTime' => time() ) );
	}

	$expected = request_signature( $secret, $request->get_method(), $request->get_route(), $timestamp, $nonce );
	if ( ! hash_equals( $expected, $signature ) ) {
		return refuse( 'wpc_bad_signature', 'The signature is wrong.' );
	}

	if ( ! remember_nonce( $nonce ) ) {
		return refuse( 'wpc_replay', 'This request was already used.' );
	}
	return true;
}

function remember_nonce( $nonce ) {
	$now    = time();
	$nonces = get_option( NONCE_OPTION, array() );
	if ( ! is_array( $nonces ) ) {
		$nonces = array();
	}

	foreach ( $nonces as $seen => $expires ) {
		if ( $expires < $now ) {
			unset( $nonces[ $seen ] );
		}
	}
	if ( isset( $nonces[ $nonce ] ) ) {
		return false;
	}

	$nonces[ $nonce ] = $now + 2 * MAX_CLOCK_SKEW;
	update_option( NONCE_OPTION, $nonces, false );
	return true;
}

function save_state( $request ) {
	$manager = esc_url_raw( (string) $request->get_header( 'X-WPC-Manager' ) );
	update_option(
		STATE_OPTION,
		array(
			'lastSync' => time(),
			'manager'  => substr( $manager, 0, 200 ),
		),
		false
	);
}

function send_snapshot( $request ) {
	$payload = wp_json_encode( collect_snapshot() );
	if ( false === $payload ) {
		return new WP_Error( 'wpc_encode', 'The site information could not be encoded.', array( 'status' => 500 ) );
	}

	$secret = (string) get_option( SECRET_OPTION, '' );
	$nonce  = (string) $request->get_header( 'X-WPC-Nonce' );
	save_state( $request );

	$response = new WP_REST_Response(
		array(
			'payload'   => $payload,
			'signature' => response_signature( $secret, $nonce, $payload ),
		)
	);
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}
