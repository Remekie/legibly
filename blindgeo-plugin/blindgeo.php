<?php
/**
 * Plugin Name: BlindGEO — AI Visibility
 * Plugin URI:  https://blindgeo.com
 * Description: Connect your WordPress site to BlindGEO. Automatically apply AI visibility fixes — robots.txt AI rules, llms.txt, and Organization schema — with one click from your BlindGEO dashboard.
 * Version:     1.0.0
 * Author:      BlindGEO
 * Author URI:  https://blindgeo.com
 * License:     GPL-2.0+
 * Text Domain: blindgeo
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'BLINDGEO_VERSION', '1.0.0' );
define( 'BLINDGEO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

require_once BLINDGEO_PLUGIN_DIR . 'includes/class-token.php';
require_once BLINDGEO_PLUGIN_DIR . 'includes/class-fixes.php';
require_once BLINDGEO_PLUGIN_DIR . 'includes/class-api.php';
require_once BLINDGEO_PLUGIN_DIR . 'includes/class-dashboard.php';

// Register REST routes
add_action( 'rest_api_init', array( 'BlindGEO_API', 'register_routes' ) );

// Apply active fixes on frontend
add_action( 'wp_head', array( 'BlindGEO_Fixes', 'inject_schema' ), 1 );
add_filter( 'robots_txt', array( 'BlindGEO_Fixes', 'filter_robots_txt' ), 10, 2 );

// Admin dashboard widget
add_action( 'wp_dashboard_setup', array( 'BlindGEO_Dashboard', 'register_widget' ) );
add_action( 'admin_menu', array( 'BlindGEO_Dashboard', 'register_page' ) );
add_action( 'admin_enqueue_scripts', array( 'BlindGEO_Dashboard', 'enqueue_assets' ) );

// Activation: generate API token
register_activation_hook( __FILE__, array( 'BlindGEO_Token', 'generate_on_activate' ) );
