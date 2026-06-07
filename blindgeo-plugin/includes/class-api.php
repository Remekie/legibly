<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BlindGEO_API {

    const NAMESPACE = 'blindgeo/v1';

    public static function register_routes() {
        // Ping — test connection
        register_rest_route( self::NAMESPACE, '/ping', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'handle_ping' ),
            'permission_callback' => array( __CLASS__, 'check_token' ),
        ));

        // Apply fixes
        register_rest_route( self::NAMESPACE, '/apply', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_apply' ),
            'permission_callback' => array( __CLASS__, 'check_token' ),
        ));

        // Get current grade (calls BlindGEO API)
        register_rest_route( self::NAMESPACE, '/status', array(
            'methods'             => 'GET',
            'callback'            => array( __CLASS__, 'handle_status' ),
            'permission_callback' => array( __CLASS__, 'check_token' ),
        ));
    }

    public static function check_token( $request ) {
        if ( ! BlindGEO_Token::verify( $request ) ) {
            return new WP_Error( 'blindgeo_unauthorized', 'Invalid or missing BlindGEO token.', array( 'status' => 401 ) );
        }
        return true;
    }

    public static function handle_ping( $request ) {
        return rest_ensure_response( array(
            'ok'         => true,
            'site_url'   => get_site_url(),
            'wp_version' => get_bloginfo( 'version' ),
            'plugin_ver' => BLINDGEO_VERSION,
        ));
    }

    public static function handle_apply( $request ) {
        $body  = $request->get_json_params();
        $fixes = isset( $body['fixes'] ) && is_array( $body['fixes'] ) ? $body['fixes'] : array();

        if ( empty( $fixes ) ) {
            return new WP_Error( 'blindgeo_no_fixes', 'No fixes provided.', array( 'status' => 400 ) );
        }

        $result = BlindGEO_Fixes::apply( $fixes );
        return rest_ensure_response( $result );
    }

    public static function handle_status( $request ) {
        return rest_ensure_response( array(
            'ok'           => true,
            'has_schema'   => ! empty( get_option( BlindGEO_Fixes::SCHEMA_KEY ) ),
            'has_llmstxt'  => ! empty( get_option( BlindGEO_Fixes::LLMSTXT_KEY ) ) || file_exists( ABSPATH . 'llms.txt' ),
            'has_robots'   => ! empty( get_option( BlindGEO_Fixes::ROBOTS_KEY ) ),
        ));
    }
}
