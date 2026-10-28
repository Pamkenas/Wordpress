<?php
/**
 * Plugin Name:       WP Control Manager
 * Description:       The agency's dashboard for client websites: status, pending updates, backups, detected changes and the maintenance log. It reads each site through WP Control Agent.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-control-manager
 * Update URI:        false
 */

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const PLUGIN_FILE          = __FILE__;
const VERSION              = '1.0.0';
const DB_VERSION           = '1';
const LATEST_AGENT_VERSION = '1.0.0';
const AGENT_PLUGIN         = 'wp-control-agent/wp-control-agent.php';
const AGENT_ROUTE          = '/wp-control-agent/v1/snapshot';
const CAPABILITY           = 'manage_wp_control';
const PAGE_SLUG            = 'wp-control';
const SETTINGS_OPTION      = 'wp_control_manager_settings';
const DB_OPTION            = 'wp_control_manager_db';
const SYNC_HOOK            = 'wp_control_manager_sync';
const SYNC_NOW_HOOK        = 'wp_control_manager_sync_now';
const KEY_PATTERN          = '/^wpc1-[a-f0-9]{64}$/';

require_once __DIR__ . '/includes/install.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/crypto.php';
require_once __DIR__ . '/includes/signature.php';
require_once __DIR__ . '/includes/agent-client.php';
require_once __DIR__ . '/includes/checks.php';
require_once __DIR__ . '/includes/sync.php';
require_once __DIR__ . '/includes/data.php';
require_once __DIR__ . '/includes/actions.php';
require_once __DIR__ . '/includes/csv.php';
require_once __DIR__ . '/includes/rest.php';
require_once __DIR__ . '/includes/admin.php';
require_once __DIR__ . '/includes/views/components.php';
require_once __DIR__ . '/includes/views/overview.php';
require_once __DIR__ . '/includes/views/websites.php';
require_once __DIR__ . '/includes/views/site.php';
require_once __DIR__ . '/includes/views/clients.php';
require_once __DIR__ . '/includes/views/maintenance.php';
require_once __DIR__ . '/includes/views/activity.php';
require_once __DIR__ . '/includes/views/backups.php';
require_once __DIR__ . '/includes/views/security.php';
require_once __DIR__ . '/includes/views/reports.php';
require_once __DIR__ . '/includes/views/settings.php';

register_activation_hook( __FILE__, __NAMESPACE__ . '\activate' );
register_deactivation_hook( __FILE__, __NAMESPACE__ . '\deactivate' );
