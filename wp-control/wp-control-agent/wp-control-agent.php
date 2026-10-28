<?php
/**
 * Plugin Name:       WP Control Agent
 * Description:       Lets the agency's WP Control Manager read this site's WordPress, PHP, plugin, theme, update and backup information. Read-only: it never changes anything.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-control-agent
 * Update URI:        false
 */

namespace WPControlAgent;

defined( 'ABSPATH' ) || exit;

const VERSION        = '1.0.0';
const REST_NAMESPACE = 'wp-control-agent/v1';
const SECRET_OPTION  = 'wp_control_agent_secret';
const CREATED_OPTION = 'wp_control_agent_key_created';
const STATE_OPTION   = 'wp_control_agent_state';
const NONCE_OPTION   = 'wp_control_agent_nonces';
const MAX_CLOCK_SKEW = 300;
const PAGE_SLUG      = 'wp-control-agent';

require_once __DIR__ . '/includes/signature.php';
require_once __DIR__ . '/includes/snapshot.php';
require_once __DIR__ . '/includes/rest.php';
require_once __DIR__ . '/includes/admin.php';
