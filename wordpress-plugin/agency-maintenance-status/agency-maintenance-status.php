<?php
/**
 * Plugin Name:       Agency Maintenance Status
 * Description:       Read-only REST endpoint (GET /wp-json/agency-maintenance/v1/status) with the WordPress core version and WordPress' cached update data, for the agency maintenance collector. Adds a least-privilege "Maintenance Auditor" role that cannot change anything.
 * Version:           1.0.1
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       agency-maintenance-status
 * Update URI:        false
 *
 * @package AgencyMaintenanceStatus
 */

namespace AgencyMaintenanceStatus;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;
use WP_User;

defined( 'ABSPATH' ) || exit;

const VERSION        = '1.0.1';
const SCHEMA_VERSION = 1;
const REST_NAMESPACE = 'agency-maintenance/v1';
const CAPABILITY     = 'view_agency_maintenance_status';
const ROLE           = 'agency_maintenance_auditor';

const REST_ONLY_CAPS = array( 'activate_plugins', 'switch_themes' );
const AUDITOR_CAPS   = array(
	'read'             => true,
	'activate_plugins' => true,
	'switch_themes'    => true,
	CAPABILITY         => true,
);

function activate() {
	$admin = get_role( 'administrator' );
	if ( $admin ) {
		$admin->add_cap( CAPABILITY );
	}

	$role = get_role( ROLE );
	if ( ! $role ) {
		add_role( ROLE, 'Maintenance Auditor (read-only)', AUDITOR_CAPS );
		return;
	}
	foreach ( AUDITOR_CAPS as $cap => $grant ) {
		$role->add_cap( $cap, $grant );
	}
}
register_activation_hook( __FILE__, __NAMESPACE__ . '\activate' );

function deactivate() {
	remove_role( ROLE );
	$admin = get_role( 'administrator' );
	if ( $admin ) {
		$admin->remove_cap( CAPABILITY );
	}
}
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\deactivate' );

function is_auditor( $user = null ) {
	$user = $user instanceof WP_User ? $user : wp_get_current_user();
	return array( ROLE ) === array_values( (array) $user->roles );
}

function is_read_only_rest_request() {
	if ( ! ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return false;
	}
	if ( isset( $_GET['_method'] ) || isset( $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ) ) {
		return false;
	}
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) : '';
	return in_array( $method, array( 'GET', 'HEAD' ), true );
}

function filter_auditor_caps( $allcaps, $caps, $args, $user ) {
	if ( empty( $allcaps[ CAPABILITY ] ) || ! is_auditor( $user ) || is_read_only_rest_request() ) {
		return $allcaps;
	}
	foreach ( REST_ONLY_CAPS as $cap ) {
		$allcaps[ $cap ] = false;
	}
	return $allcaps;
}
add_filter( 'user_has_cap', __NAMESPACE__ . '\filter_auditor_caps', 10, 4 );

function block_auditor_writes( $result, $server, $request ) {
	if ( null !== $result || ! is_auditor() || in_array( $request->get_method(), array( 'GET', 'HEAD' ), true ) ) {
		return $result;
	}
	return new WP_Error(
		'agency_maintenance_read_only',
		__( 'The maintenance auditor account is read-only.', 'agency-maintenance-status' ),
		array( 'status' => 403 )
	);
}
add_filter( 'rest_pre_dispatch', __NAMESPACE__ . '\block_auditor_writes', 10, 3 );

function register_routes() {
	register_rest_route(
		REST_NAMESPACE,
		'/status',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => __NAMESPACE__ . '\get_status',
			'permission_callback' => __NAMESPACE__ . '\can_view_status',
			'args'                => array(),
		)
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\register_routes' );

function can_view_status() {
	if ( current_user_can( CAPABILITY ) ) {
		return true;
	}
	return new WP_Error(
		'rest_forbidden',
		__( 'Sorry, you are not allowed to view the maintenance status.', 'agency-maintenance-status' ),
		array( 'status' => rest_authorization_required_code() )
	);
}

function get_status() {
	if ( ! function_exists( 'get_mu_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	$response = new WP_REST_Response(
		array(
			'schemaVersion'  => SCHEMA_VERSION,
			'pluginVersion'  => VERSION,
			'generatedAt'    => gmdate( 'c' ),
			'core'           => core_status(),
			'plugins'        => transient_status( get_site_transient( 'update_plugins' ) ),
			'themes'         => transient_status( get_site_transient( 'update_themes' ) ),
			'mustUsePlugins' => extra_plugins( get_mu_plugins() ),
			'dropins'        => extra_plugins( get_dropins() ),
		)
	);
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}

function core_status() {
	$installed = function_exists( 'wp_get_wp_version' ) ? wp_get_wp_version() : get_bloginfo( 'version' );
	$cached    = get_site_transient( 'update_core' );

	$last_checked = is_object( $cached ) && ! empty( $cached->last_checked ) ? (int) $cached->last_checked : null;
	$checked      = null !== $last_checked
		&& isset( $cached->version_checked, $cached->updates )
		&& $cached->version_checked === $installed
		&& is_array( $cached->updates );

	$offered = null;
	if ( $checked ) {
		foreach ( $cached->updates as $offer ) {
			if ( ! is_object( $offer ) || ! isset( $offer->response, $offer->current ) ) {
				continue;
			}
			if ( ! in_array( $offer->response, array( 'upgrade', 'autoupdate' ), true ) ) {
				continue;
			}
			$version = (string) $offer->current;
			if ( version_compare( $version, $installed, '>' ) && ( null === $offered || version_compare( $version, $offered, '>' ) ) ) {
				$offered = $version;
			}
		}
	}

	return array(
		'installed'   => (string) $installed,
		'checked'     => $checked,
		'offered'     => $offered,
		'lastChecked' => $last_checked,
	);
}

function transient_status( $cached ) {
	if ( ! is_object( $cached ) || empty( $cached->last_checked ) ) {
		return array(
			'checked'         => false,
			'lastChecked'     => null,
			'updates'         => new \stdClass(),
			'noUpdate'        => array(),
			'checkedVersions' => new \stdClass(),
		);
	}

	$updates = array();
	foreach ( (array) ( $cached->response ?? array() ) as $id => $item ) {
		$item             = (array) $item;
		$updates[ "$id" ] =isset( $item['new_version'] ) && is_scalar( $item['new_version'] ) ? (string) $item['new_version'] : null;
	}

	$checked_versions = array();
	foreach ( (array) ( $cached->checked ?? array() ) as $id => $version ) {
		if ( is_scalar( $version ) ) {
			$checked_versions[ "$id" ] = (string) $version;
		}
	}

	return array(
		'checked'         => true,
		'lastChecked'     => (int) $cached->last_checked,
		'updates'         => (object) $updates,
		'noUpdate'        => array_map( 'strval', array_keys( (array) ( $cached->no_update ?? array() ) ) ),
		'checkedVersions' => (object) $checked_versions,
	);
}

function extra_plugins( $plugins ) {
	$result = array();
	foreach ( (array) $plugins as $file => $data ) {
		$result[] = array(
			'file'    => (string) $file,
			'name'    => ! empty( $data['Name'] ) ? (string) $data['Name'] : (string) $file,
			'version' => isset( $data['Version'] ) ? (string) $data['Version'] : '',
		);
	}
	return $result;
}
