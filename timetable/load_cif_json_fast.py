#!/usr/bin/env python3
"""
Fast CIF JSON loader with TIPLOC cache and bulk inserts
Optimized for loading large 3GB+ files
"""

import json
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime
import sys
import os
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

# Global cache for TIPLOC to STANOX mappings
TIPLOC_CACHE = {}

def connect_db():
    return psycopg2.connect(**DB_CONFIG)

def load_tiploc_cache(conn):
    """Load all TIPLOC→STANOX mappings into memory"""
    global TIPLOC_CACHE
    print("Loading TIPLOC→STANOX cache into memory...")
    with conn.cursor() as cur:
        cur.execute("SELECT tiploc, stanox FROM tiploc_reference WHERE tiploc IS NOT NULL")
        TIPLOC_CACHE = {tiploc: stanox for tiploc, stanox in cur}
    print(f"✓ Cached {len(TIPLOC_CACHE):,} TIPLOC mappings\n")

def convert_tiploc_array_to_stanox(tiploc_array):
    """Fast conversion using in-memory cache"""
    return [TIPLOC_CACHE.get(tiploc) for tiploc in tiploc_array]

def parse_schedule(schedule_json):
    """Parse schedule JSON into tuple for bulk insert"""
    try:
        train_uid = schedule_json.get('CIF_train_uid')
        stp_indicator = schedule_json.get('CIF_stp_indicator', 'P')
        
        start_date_str = schedule_json.get('schedule_start_date')
        end_date_str = schedule_json.get('schedule_end_date')
        if not start_date_str or not end_date_str:
            return None
            
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        days_runs = schedule_json.get('schedule_days_runs', '0000000')
        
        segment = schedule_json.get('schedule_segment', {})
        atoc_code = schedule_json.get('atoc_code')
        train_status = schedule_json.get('train_status', 'P')
        train_category = segment.get('CIF_train_category')
        signalling_id = segment.get('signalling_id')
        headcode = segment.get('CIF_headcode')
        service_code = segment.get('CIF_train_service_code')
        power_type = segment.get('CIF_power_type')
        timing_load = segment.get('CIF_timing_load')
        speed = segment.get('CIF_speed')
        train_class = segment.get('CIF_train_class')
        sleepers = segment.get('CIF_sleepers')
        reservations = segment.get('CIF_reservations')
        catering_code = segment.get('CIF_catering_code')
        service_branding = segment.get('CIF_service_branding')
        
        locations = segment.get('schedule_location', [])
        if not locations:
            return None
            
        tiploc_array = []
        timing_data = []
        
        for loc in locations:
            tiploc = loc.get('tiploc_code')
            if not tiploc:
                continue
            tiploc_array.append(tiploc)
            timing_data.append({
                'tiploc': tiploc,
                'location_type': loc.get('location_type'),
                'arrival': loc.get('arrival'),
                'departure': loc.get('departure'),
                'pass': loc.get('pass'),
                'public_arrival': loc.get('public_arrival'),
                'public_departure': loc.get('public_departure'),
                'platform': loc.get('platform'),
                'line': loc.get('line')
            })
        
        if not tiploc_array:
            return None
        
        stanox_array = convert_tiploc_array_to_stanox(tiploc_array)
        transaction_type = schedule_json.get('transaction_type', 'Create')
        applicable_timetable = schedule_json.get('applicable_timetable', 'Y')
        
        return (
            train_uid, stp_indicator, start_date, end_date, days_runs,
            atoc_code, train_status, train_category, signalling_id, headcode,
            service_code, power_type, timing_load, speed, train_class,
            sleepers, reservations, catering_code, service_branding,
            tiploc_array, stanox_array, json.dumps(timing_data),
            transaction_type, applicable_timetable
        )
    except Exception as e:
        return None

def bulk_insert_schedules(conn, schedules):
    """Bulk insert schedules using execute_values for speed"""
    if not schedules:
        return
    
    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO active_schedule (
                cif_train_uid, cif_stp_indicator, schedule_start_date, schedule_end_date,
                schedule_days_runs, atoc_code, train_status, train_category,
                signalling_id, headcode, service_code, power_type, timing_load,
                speed, train_class, sleepers, reservations, catering_code,
                service_branding, tiploc_array, stanox_array, timing_data,
                transaction_type, applicable_timetable
            ) VALUES %s
            ON CONFLICT (cif_train_uid, schedule_start_date, cif_stp_indicator)
            DO UPDATE SET
                schedule_end_date = EXCLUDED.schedule_end_date,
                schedule_days_runs = EXCLUDED.schedule_days_runs,
                atoc_code = EXCLUDED.atoc_code,
                train_status = EXCLUDED.train_status,
                train_category = EXCLUDED.train_category,
                signalling_id = EXCLUDED.signalling_id,
                headcode = EXCLUDED.headcode,
                service_code = EXCLUDED.service_code,
                power_type = EXCLUDED.power_type,
                timing_load = EXCLUDED.timing_load,
                speed = EXCLUDED.speed,
                train_class = EXCLUDED.train_class,
                sleepers = EXCLUDED.sleepers,
                reservations = EXCLUDED.reservations,
                catering_code = EXCLUDED.catering_code,
                service_branding = EXCLUDED.service_branding,
                tiploc_array = EXCLUDED.tiploc_array,
                stanox_array = EXCLUDED.stanox_array,
                timing_data = EXCLUDED.timing_data,
                transaction_type = EXCLUDED.transaction_type,
                applicable_timetable = EXCLUDED.applicable_timetable,
                updated_at = CURRENT_TIMESTAMP
        """, schedules)

def load_cif_json(filename):
    """Load CIF JSON file with optimized bulk inserts"""
    conn = connect_db()
    
    try:
        print(f"\n{'='*70}")
        print(f"FAST CIF JSON LOADER")
        print(f"{'='*70}")
        print(f"File: {filename}")
        
        file_size = os.path.getsize(filename)
        print(f"Size: {file_size / (1024**3):.2f} GB\n")
        
        # Load TIPLOC cache first
        load_tiploc_cache(conn)
        
        print("Processing schedules...")
        print("(Progress shown every 10,000 schedules)\n")
        
        schedules_batch = []
        batch_size = 1000  # Bulk insert 1000 at a time
        schedules_processed = 0
        lines_read = 0
        
        with open(filename, 'r') as f:
            for line in f:
                lines_read += 1
                
                try:
                    data = json.loads(line)
                    
                    if 'JsonScheduleV1' in data:
                        schedule_tuple = parse_schedule(data['JsonScheduleV1'])
                        if schedule_tuple:
                            schedules_batch.append(schedule_tuple)
                            
                            if len(schedules_batch) >= batch_size:
                                bulk_insert_schedules(conn, schedules_batch)
                                schedules_processed += len(schedules_batch)
                                conn.commit()
                                schedules_batch = []
                                
                                if schedules_processed % 1000 == 0:
                                    print(f"✓ Processed {schedules_processed:,} schedules (read {lines_read:,} lines)", flush=True)
                
                except:
                    continue
        
        # Insert remaining
        if schedules_batch:
            bulk_insert_schedules(conn, schedules_batch)
            schedules_processed += len(schedules_batch)
            conn.commit()
        
        print(f"\n{'='*70}")
        print(f"LOADING COMPLETE!")
        print(f"{'='*70}")
        print(f"Lines read: {lines_read:,}")
        print(f"Schedules loaded: {schedules_processed:,}")
        
        # Statistics
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM active_schedule")
            total = cur.fetchone()[0]
            cur.execute("SELECT COUNT(DISTINCT cif_train_uid) FROM active_schedule")
            unique = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM active_schedule WHERE train_status = 'P'")
            passenger = cur.fetchone()[0]
            
            print(f"\nDatabase Statistics:")
            print(f"  Total schedules: {total:,}")
            print(f"  Unique train UIDs: {unique:,}")
            print(f"  Passenger trains: {passenger:,}")
        print(f"{'='*70}\n")
        
    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 load_cif_json_fast.py <filename>")
        sys.exit(1)
    
    filename = sys.argv[1]
    if not os.path.exists(filename):
        print(f"ERROR: File not found: {filename}")
        sys.exit(1)
    
    load_cif_json(filename)


