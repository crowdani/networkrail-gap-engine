import { NextResponse } from 'next/server';
import { getFeatureFlags } from '@/lib/feature-flags';

/**
 * GET /api/feature-flags
 * Returns the current feature flags configuration
 */
export async function GET() {
  try {
    const flags = getFeatureFlags();
    
    return NextResponse.json({
      success: true,
      flags,
    });
  } catch (error) {
    console.error('Error fetching feature flags:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch feature flags',
        flags: {
          externalVerificationEnabled: false,
        },
      },
      { status: 500 }
    );
  }
}


