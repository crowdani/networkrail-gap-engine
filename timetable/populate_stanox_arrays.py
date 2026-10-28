#!/usr/bin/env python3
"""
Populate STANOX Arrays in active_schedule Table
Reads CIF file, extracts location sequences, looks up STANOXs, and updates database
"""

import json
import psycopg2
from psycopg2.extras import execute_batch
import sys
import os
from collections import defaultdict
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

DB_CONFIG = {
    'host': os.getenv('POSTGRES_HOST', 'localhost'),
    'port': int(os.getenv('POSTGRES_PORT', 5432)),
    'database': os.getenv('POSTGRES_DB', 'network_rail'),
    'user': os.getenv('POSTGRES_USER', 'postgres'),
    'password': os.getenv('POSTGRES_PASSWORD', 'postgres')
}

BATCH_SIZE = 500
PROGRESS_INTERVAL = 5000

def load_tiploc_to_stanox_mapping(conn):
    """Load TIPLOC to STANOX mapping from database"""
    print("📍 Loading TIPLOC→STANOX mappings...")
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tiploc, stanox 
        FROM tiploc_reference 
        WHERE stanox IS NOT NULL AND stanox != ''
    """)
    
    mapping = {}
    for row in cursor.fetchall():
        tiploc, stanox = row
        mapping[tiploc] = stanox
    
    cursor.close()
    print(f"✓ Loaded {len(mapping):,} TIPLOC→STANOX mappings")
    return mapping

def extract_schedule_locations(schedule_data):
    """Extract ordered list of TIPLOCs from schedule"""
    try:
        schedule_segment = schedule_data.get('schedule_segment', {})
        locations = schedule_segment.get('schedule_location', [])
        
        if not locations:
            return []
        
        # Extract tiploc_code from each location in order
        tiplocs = []
        for loc in locations:
            tiploc = loc.get('tiploc_code')
            if tiploc:
                tiplocs.append(tiploc)
        
        return tiplocs
    except Exception as e:
        return []

def process_schedules(conn, tiploc_mapping):
    """Process CIF file and update schedules with STANOX arrays"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    filename = os.path.join(script_dir, 'toc-full')
    
    print(f"📖 Processing schedules from {filename}...")
    print(f"   Batch size: {BATCH_SIZE}")
    print()
    
    batch = []
    processed = 0
    updated = 0
    skipped_no_locations = 0
    skipped_no_stanox = 0
    
    try:
        with open(filename, 'r') as f:
            for line_num, line in enumerate(f, 1):
                try:
                    data = json.loads(line.strip())
                    
                    # Only process schedule records
                    if 'JsonScheduleV1' not in data:
                        continue
                    
                    schedule = data['JsonScheduleV1']
                    train_uid = schedule.get('CIF_train_uid')
                    
                    if not train_uid:
                        continue
                    
                    # Extract location sequence
                    tiplocs = extract_schedule_locations(schedule)
                    
                    if not tiplocs:
                        skipped_no_locations += 1
                        continue
                    
                    # Map TIPLOCs to STANOXs
                    stanox_list = []
                    for tiploc in tiplocs:
                        stanox = tiploc_mapping.get(tiploc)
                        if stanox:
                            stanox_list.append(stanox)
                    
                    # Only update if we got at least some STANOXs
                    if not stanox_list:
                        skipped_no_stanox += 1
                        continue
                    
                    batch.append({
                        'train_uid': train_uid,
                        'tiploc_array': tiplocs,
                        'stanox_array': stanox_list
                    })
                    
                    processed += 1
                    
                    # Process batch
                    if len(batch) >= BATCH_SIZE:
                        updated += update_batch(conn, batch)
                        batch = []
                    
                    # Progress update
                    if processed % PROGRESS_INTERVAL == 0:
                        print(f"   Processed: {processed:,} | Updated: {updated:,} | "
                              f"No locations: {skipped_no_locations:,} | No STANOX: {skipped_no_stanox:,}")
                
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    print(f"  Error processing line {line_num}: {e}")
                    continue
        
        # Process remaining batch
        if batch:
            updated += update_batch(conn, batch)
        
        print()
        print("=" * 60)
        print("✓ Processing Complete!")
        print(f"   Total processed: {processed:,}")
        print(f"   Successfully updated: {updated:,}")
        print(f"   Skipped (no locations): {skipped_no_locations:,}")
        print(f"   Skipped (no STANOX mapping): {skipped_no_stanox:,}")
        print("=" * 60)
        
    except FileNotFoundError:
        print(f"❌ File not found: {filename}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    
    return True

def update_batch(conn, batch):
    """Update a batch of schedules with STANOX arrays"""
    if not batch:
        return 0
    
    cursor = conn.cursor()
    
    query = """
        UPDATE active_schedule
        SET 
            stanox_array = %s,
            tiploc_array = %s
        WHERE cif_train_uid = %s
    """
    
    values = [
        (item['stanox_array'], item['tiploc_array'], item['train_uid'])
        for item in batch
    ]
    
    try:
        execute_batch(cursor, query, values, page_size=100)
        conn.commit()
        result = len(values)
    except Exception as e:
        print(f"\n  Batch update error: {e}")
        conn.rollback()
        result = 0
    finally:
        cursor.close()
    
    return result

def verify_results(conn):
    """Verify the update results"""
    print()
    print("🔍 Verifying results...")
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN stanox_array IS NOT NULL AND array_length(stanox_array, 1) > 0 THEN 1 END) as with_stanox,
            COUNT(CASE WHEN tiploc_array IS NOT NULL AND array_length(tiploc_array, 1) > 0 THEN 1 END) as with_tiploc
        FROM active_schedule
    """)
    
    row = cursor.fetchone()
    total, with_stanox, with_tiploc = row
    
    print(f"   Total schedules: {total:,}")
    if total == 0:
        print("   ⚠ No schedules found — run load_cif_json_fast.py first")
        return
    print(f"   With STANOX arrays: {with_stanox:,} ({with_stanox/total*100:.1f}%)")
    print(f"   With TIPLOC arrays: {with_tiploc:,} ({with_tiploc/total*100:.1f}%)")
    
    # Show sample
    cursor.execute("""
        SELECT cif_train_uid, array_length(stanox_array, 1) as stanox_count, stanox_array[1:5]
        FROM active_schedule
        WHERE stanox_array IS NOT NULL AND array_length(stanox_array, 1) > 0
        LIMIT 3
    """)
    
    print()
    print("   Sample schedules:")
    for row in cursor.fetchall():
        uid, count, sample = row
        print(f"      {uid}: {count} stops, first 5 STANOXs: {sample}")
    
    cursor.close()

def main():
    print("=" * 60)
    print("🚂 STANOX Array Population Tool")
    print("=" * 60)
    print()
    
    # Connect to database
    print("🔌 Connecting to database...")
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print("✓ Connected to PostgreSQL")
        print()
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return 1
    
    try:
        # Load TIPLOC mappings
        tiploc_mapping = load_tiploc_to_stanox_mapping(conn)
        print()
        
        # Process schedules
        success = process_schedules(conn, tiploc_mapping)
        
        if success:
            # Verify results
            verify_results(conn)
            print()
            print("✅ STANOX arrays populated successfully!")
            return 0
        else:
            print("❌ Failed to populate STANOX arrays")
            return 1
    
    finally:
        conn.close()

if __name__ == '__main__':
    sys.exit(main())

