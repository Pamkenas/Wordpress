<?php

namespace WPControlManager;

use WP_Error;

defined( 'ABSPATH' ) || exit;

const FREQUENCIES = array(
	'hourly'     => 'Every hour',
	'twicedaily' => 'Twice a day',
	'daily'      => 'Once a day',
	'manual'     => 'Only when I click Sync',
);

const CATEGORIES = array(
	'update'        => 'Update',
	'backup'        => 'Backup',
	'security'      => 'Security',
	'configuration' => 'Configuration',
	'content'       => 'Content',
	'support'       => 'Support',
	'other'         => 'Other',
);

const STATUS_LABELS = array(
	'online'  => 'Online',
	'offline' => 'Offline',
	'error'   => 'Error',
	'pending' => 'Pending',
);

function default_settings() {
	return array(
		'frequency'            => 'hourly',
		'backup_warning_days'  => 2,
		'backup_critical_days' => 7,
		'min_php'              => '8.2',
		'csv_delimiter'        => ',',
	);
}

function settings() {
	$saved = get_option( SETTINGS_OPTION, array() );
	return array_merge( default_settings(), is_array( $saved ) ? $saved : array() );
}

function now() {
	return gmdate( 'Y-m-d H:i:s' );
}

function gmt_from_timestamp( $timestamp ) {
	return gmdate( 'Y-m-d H:i:s', (int) $timestamp );
}

function timestamp_from_gmt( $gmt ) {
	return strtotime( $gmt . ' UTC' );
}

function local_date( $gmt, $format = 'j M Y, H:i' ) {
	if ( empty( $gmt ) ) {
		return '—';
	}
	return get_date_from_gmt( $gmt, $format );
}

function time_ago( $gmt ) {
	if ( empty( $gmt ) ) {
		return 'Never';
	}
	$time = timestamp_from_gmt( $gmt );
	if ( $time > time() ) {
		return 'just now';
	}
	return human_time_diff( $time, time() ) . ' ago';
}

function days_since( $gmt ) {
	return ( time() - timestamp_from_gmt( $gmt ) ) / DAY_IN_SECONDS;
}

function clean_text( $value, $length ) {
	$text = trim( (string) preg_replace( '/\p{Cc}+/u', ' ', (string) $value ) );
	return mb_substr( $text, 0, $length );
}

function plural( $count, $one, $many ) {
	return (int) $count . ' ' . ( 1 === (int) $count ? $one : $many );
}

function clean_textarea( $value, $length ) {
	return mb_substr( trim( sanitize_textarea_field( (string) $value ) ), 0, $length );
}

function valid_month( $value ) {
	return is_string( $value ) && 1 === preg_match( '/^\d{4}-(0[1-9]|1[0-2])$/', $value );
}

function month_range( $month ) {
	$start = $month . '-01 00:00:00';
	$end   = gmdate( 'Y-m-d H:i:s', strtotime( $start . ' +1 month' ) );
	return array( get_gmt_from_date( $start ), get_gmt_from_date( $end ) );
}

function parse_local_datetime( $value ) {
	$value = trim( (string) $value );
	$date  = \DateTime::createFromFormat( 'Y-m-d\TH:i', $value, wp_timezone() );
	if ( ! $date || $date->format( 'Y-m-d\TH:i' ) !== $value ) {
		return '';
	}
	$date->setTimezone( new \DateTimeZone( 'UTC' ) );
	return $date->format( 'Y-m-d H:i:s' );
}

function remember_input( $form, $values ) {
	set_transient( 'wpc_input_' . $form . '_' . get_current_user_id(), $values, 5 * MINUTE_IN_SECONDS );
}

function old_input( $form ) {
	$key    = 'wpc_input_' . $form . '_' . get_current_user_id();
	$values = get_transient( $key );
	delete_transient( $key );
	return is_array( $values ) ? $values : array();
}

function is_local_host( $host ) {
	if ( 'localhost' === $host || '[::1]' === $host ) {
		return true;
	}
	if ( preg_match( '/^127\.\d+\.\d+\.\d+$/', $host ) ) {
		return true;
	}
	return (bool) preg_match( '/\.(localhost|local|test)$/', $host );
}

function normalize_site_url( $value ) {
	$parts = wp_parse_url( trim( (string) $value ) );
	if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
		return new WP_Error( 'wpc_url', 'Enter the full website address, for example https://www.example.com.' );
	}
	if ( isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) ) {
		return new WP_Error( 'wpc_url', 'The website address must not contain a password, a ? part or a # part.' );
	}

	$scheme = strtolower( $parts['scheme'] );
	$host   = strtolower( $parts['host'] );
	if ( 'https' !== $scheme && 'http' !== $scheme ) {
		return new WP_Error( 'wpc_url', 'The website address must start with https://.' );
	}
	if ( 'http' === $scheme && ! is_local_host( $host ) ) {
		return new WP_Error( 'wpc_url', 'Use https://. Plain http:// works only for a test site on this computer (localhost, *.local, *.test).' );
	}

	$port = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
	$path = isset( $parts['path'] ) ? rtrim( $parts['path'], '/' ) : '';
	$url  = esc_url_raw( $scheme . '://' . $host . $port . $path );
	if ( '' === $url ) {
		return new WP_Error( 'wpc_url', 'The website address is not valid.' );
	}
	return $url;
}

function page_url( $args = array() ) {
	$args = rawurlencode_deep( array_merge( array( 'page' => PAGE_SLUG ), $args ) );
	return add_query_arg( $args, admin_url( 'admin.php' ) );
}

function add_notice( $type, $message ) {
	$key     = 'wpc_notices_' . get_current_user_id();
	$notices = get_transient( $key );
	if ( ! is_array( $notices ) ) {
		$notices = array();
	}
	$notices[] = array(
		'type'    => $type,
		'message' => $message,
	);
	set_transient( $key, $notices, 5 * MINUTE_IN_SECONDS );
}

function take_notices() {
	$key     = 'wpc_notices_' . get_current_user_id();
	$notices = get_transient( $key );
	delete_transient( $key );
	return is_array( $notices ) ? $notices : array();
}

function audit( $action, $object_type, $object_id, $site_id = 0, $details = '' ) {
	global $wpdb;
	$user = wp_get_current_user();
	$wpdb->insert(
		table( 'audit_log' ),
		array(
			'user_id'     => (int) $user->ID,
			'user_name'   => $user->exists() ? clean_text( $user->display_name, 190 ) : 'System',
			'action'      => $action,
			'site_id'     => (int) $site_id,
			'object_type' => $object_type,
			'object_id'   => (int) $object_id,
			'details'     => clean_text( $details, 1000 ),
			'created_at'  => now(),
		),
		array( '%d', '%s', '%s', '%d', '%s', '%d', '%s', '%s' )
	);
}

function performers() {
	return get_users(
		array(
			'capability' => CAPABILITY,
			'orderby'    => 'display_name',
			'fields'     => array( 'ID', 'display_name' ),
		)
	);
}
