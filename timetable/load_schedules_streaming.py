#!/usr/bin/env python3
"""
Streaming Schedule Loader - Ultra Memory Efficient
Processes 700k+ schedules without counting first
"""

import json
import psycopg2
from psycopg2.extras import execute_batch
import sys
import os
from datetime import datetime
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

BATCH_SIZE = 500  # Smaller batches for memory efficiency
PROGRESS_INTERVAL = 2500  # Show progress every 2500 records

def load_schedules_batch(conn, batch):
    """Load a batch of schedules into database"""
    if not batch:
        return 0
    
    cursor = conn.cursor()
    
    # Prepare data for batch insert
    values = []
    for schedule in batch:
        if schedule.get('train_uid') and schedule.get('tiploc_array') and schedule.get('start_date') and schedule.get('end_date'):
            values.append((
                schedule['train_uid'],
                schedule.get('stp_indicator', 'P'),
                schedule['start_date'],
                schedule['end_date'],
                schedule.get('days_runs', '1111111'),
                schedule.get('atoc_code'),
                schedule.get('train_status'),
                schedule.get('train_category'),
                schedule.get('service_code'),
                schedule.get('stanox_array', []),
                schedule['tiploc_array'],
                schedule.get('timing_data')
            ))
    
    if not values:
        cursor.close()
        return 0
    
    # Simple INSERT since we delete all schedules first
    query = """
        INSERT INTO active_schedule
        (cif_train_uid, cif_stp_indicator, schedule_start_date, schedule_end_date,
         schedule_days_runs, atoc_code, train_status, train_category, service_code,
         stanox_array, tiploc_array, timing_data)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    
    try:
        execute_batch(cursor, query, values, page_size=100)
        conn.commit()
        result = len(values)
    except Exception as e:
        print(f"\n  Batch error: {e}", flush=True)
        conn.rollback()
        result = 0
    finally:
        cursor.close()
    
    return result

def main():
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    filename = os.path.join(script_dir, 'toc-full')
    
    print("=" * 60, flush=True)
    print("Streaming Schedule Loader (Memory Efficient)", flush=True)
    print("=" * 60, flush=True)
    print(flush=True)
    
    # Connect to database
    print("Connecting to database...", flush=True)
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print("Connected to PostgreSQL", flush=True)
    except Exception as e:
        print(f"Database connection failed: {e}", flush=True)
        return 1
    
    # Clear existing schedules
    print("Clearing existing schedules...", flush=True)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM active_schedule WHERE cif_train_uid != 'TESTUID001'")
    conn.commit()
    cursor.close()
    print("Cleared old schedules", flush=True)
    print(flush=True)
    
    # Process file in streaming mode
    print(f"Streaming schedules from file...", flush=True)
    print(f"   Batch size: {BATCH_SIZE}", flush=True)
    print(f"   Progress updates every {PROGRESS_INTERVAL:,} schedules", flush=True)
    print(flush=True)
    
    batch = []
    processed = 0
    loaded = 0
    errors = 0
    start_time = datetime.now()
    last_progress_time = start_time
    
    try:
        with open(filename, 'r') as f:
            for line_num, line in enumerate(f, 1):
                try:
                    line = line.strip()
                    if not line:
                        continue
                    
                    data = json.loads(line)
                    
                    if 'JsonScheduleV1' in data:
                        schedule_data = data['JsonScheduleV1']
                        
                        # Extract data from TOP LEVEL of JsonScheduleV1
                        train_uid = schedule_data.get('CIF_train_uid')
                        stp_indicator = schedule_data.get('CIF_stp_indicator', 'P')
                        start_date = schedule_data.get('schedule_start_date')
                        end_date = schedule_data.get('schedule_end_date')
                        days_runs = schedule_data.get('schedule_days_runs') or '1111111'
                        atoc_code = schedule_data.get('atoc_code')
                        train_status = schedule_data.get('train_status')
                        
                        # Extract TIPLOCs, timing data, and service code from schedule_segment
                        schedule_segment = schedule_data.get('schedule_segment', {})
                        train_category = schedule_segment.get('CIF_train_category')
                        service_code = schedule_segment.get('CIF_train_service_code')
                        
                        tiploc_list = []
                        timing_data = []
                        locations = schedule_segment.get('schedule_location', [])
                        for loc in locations:
                            tiploc = loc.get('tiploc_code')
                            if tiploc:
                                tiploc_list.append(tiploc)
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
                        
                        if train_uid and tiploc_list and start_date and end_date:
                            batch.append({
                                'train_uid': train_uid,
                                'stp_indicator': stp_indicator,
                                'start_date': start_date,
                                'end_date': end_date,
                                'days_runs': days_runs,
                                'atoc_code': atoc_code,
                                'train_status': train_status,
                                'train_category': train_category,
                                'service_code': service_code,
                                'stanox_array': [],  # Populated by populate_stanox_arrays.py
                                'tiploc_array': tiploc_list,
                                'timing_data': json.dumps(timing_data)
                            })
                            processed += 1
                        
                        # Process batch when full
                        if len(batch) >= BATCH_SIZE:
                            loaded += load_schedules_batch(conn, batch)
                            batch = []
                        
                        # Show progress
                        if processed % PROGRESS_INTERVAL == 0:
                            now = datetime.now()
                            elapsed = (now - start_time).total_seconds()
                            interval_elapsed = (now - last_progress_time).total_seconds()
                            rate = PROGRESS_INTERVAL / interval_elapsed if interval_elapsed > 0 else 0
                            last_progress_time = now
                            
                            print(f"  {datetime.now().strftime('%H:%M:%S')} | "
                                  f"Processed: {processed:,} | "
                                  f"Loaded: {loaded:,} | "
                                  f"Rate: {rate:.0f}/sec | "
                                  f"Time: {elapsed/60:.1f}min", flush=True)
                
                except json.JSONDecodeError:
                    errors += 1
                    continue
                except KeyError:
                    errors += 1
                    continue
                except Exception as e:
                    errors += 1
                    if errors % 1000 == 0:
                        print(f"    {errors} errors so far (last: {str(e)[:40]})", flush=True)
                    continue
        
        # Process remaining batch
        if batch:
            loaded += load_schedules_batch(conn, batch)
        
        elapsed = (datetime.now() - start_time).total_seconds()
        
        print()
        print("=" * 60)
        print("Schedule loading complete!")
        print(f"   Processed: {processed:,} schedules")
        print(f"   Loaded: {loaded:,} schedules")
        print(f"   Errors: {errors:,}")
        print(f"   Time: {elapsed/60:.1f} minutes ({elapsed:.0f} seconds)")
        print(f"   Average rate: {processed/elapsed:.0f} schedules/sec")
        print("=" * 60)
        
    except KeyboardInterrupt:
        print(flush=True)
        print("  Interrupted by user", flush=True)
        print(f"   Processed: {processed:,} schedules before interruption", flush=True)
        print(f"   Loaded: {loaded:,} schedules", flush=True)
        conn.rollback()
        return 1
    except Exception as e:
        print(f"\nFatal error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        conn.rollback()
        return 1
    finally:
        conn.close()
    
    return 0

if __name__ == '__main__':
    sys.exit(main())

