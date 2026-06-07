<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BlindGEO_Fixes {

    const SCHEMA_KEY  = 'blindgeo_schema_json';
    const LLMSTXT_KEY = 'blindgeo_llmstxt_content';
    const ROBOTS_KEY  = 'blindgeo_robots_additions';

    // ── Apply fixes from payload ─────────────────────────────────────────────

    public static function apply( $fixes ) {
        $applied = array();
        $errors  = array();

        foreach ( $fixes as $fix ) {
            $type = sanitize_key( $fix['type'] ?? '' );
            switch ( $type ) {
                case 'robots':
                    $result = self::apply_robots();
                    break;
                case 'llmstxt':
                    $result = self::apply_llmstxt( $fix['content'] ?? '' );
                    break;
                case 'schema':
                    $result = self::apply_schema( $fix['snippet'] ?? '' );
                    break;
                default:
                    $result = array( 'ok' => false, 'error' => "Unknown fix type: {$type}" );
            }
            if ( ! empty( $result['ok'] ) ) {
                $applied[] = $type;
            } else {
                $errors[] = array( 'type' => $type, 'error' => $result['error'] ?? 'Unknown error' );
            }
        }

        return array( 'applied' => $applied, 'errors' => $errors );
    }

    // ── robots.txt — add AI crawler allow rules ──────────────────────────────

    public static function apply_robots() {
        $rules = "User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n";
        update_option( self::ROBOTS_KEY, $rules, false );
        return array( 'ok' => true );
    }

    public static function filter_robots_txt( $output, $public ) {
        $additions = get_option( self::ROBOTS_KEY, '' );
        if ( ! empty( $additions ) ) {
            $output = $additions . "\n" . $output;
        }
        return $output;
    }

    // ── llms.txt — write to site root ────────────────────────────────────────

    public static function apply_llmstxt( $content ) {
        if ( empty( $content ) ) {
            return array( 'ok' => false, 'error' => 'No llms.txt content provided' );
        }
        // Store in options (used as fallback) and attempt file write
        update_option( self::LLMSTXT_KEY, wp_kses_post( $content ), false );

        $upload_dir = wp_get_upload_dir();
        $root_path  = ABSPATH . 'llms.txt';

        if ( ! function_exists( 'WP_Filesystem' ) ) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
        }
        WP_Filesystem();
        global $wp_filesystem;

        if ( $wp_filesystem && $wp_filesystem->put_contents( $root_path, $content, FS_CHMOD_FILE ) ) {
            return array( 'ok' => true );
        }
        // Even if file write fails, content is stored in options — serve via rewrite rule
        return array( 'ok' => true, 'note' => 'Stored in options; file write requires FTP credentials' );
    }

    // ── Schema — inject JSON-LD in <head> ────────────────────────────────────

    public static function apply_schema( $snippet ) {
        if ( empty( $snippet ) ) {
            return array( 'ok' => false, 'error' => 'No schema snippet provided' );
        }
        // Validate it's JSON before storing
        $decoded = json_decode( $snippet );
        if ( json_last_error() !== JSON_ERROR_NONE ) {
            return array( 'ok' => false, 'error' => 'Schema is not valid JSON' );
        }
        update_option( self::SCHEMA_KEY, wp_slash( $snippet ), false );
        return array( 'ok' => true );
    }

    public static function inject_schema() {
        $schema = get_option( self::SCHEMA_KEY, '' );
        if ( ! empty( $schema ) ) {
            // Output raw — already validated as JSON on storage
            echo '<script type="application/ld+json">' . wp_unslash( $schema ) . '</script>' . "\n";
        }
    }
}
