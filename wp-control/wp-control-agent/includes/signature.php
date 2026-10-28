<?php

namespace WPControlAgent;

defined( 'ABSPATH' ) || exit;

function sign( $secret, $parts ) {
	return hash_hmac( 'sha256', implode( "\n", $parts ), $secret );
}

function request_signature( $secret, $method, $route, $timestamp, $nonce ) {
	return sign( $secret, array( 'request', $method, $route, $timestamp, $nonce ) );
}

function response_signature( $secret, $nonce, $payload ) {
	return sign( $secret, array( 'response', $nonce, hash( 'sha256', $payload ) ) );
}

function new_secret() {
	return 'wpc1-' . bin2hex( random_bytes( 32 ) );
}
