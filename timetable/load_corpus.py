#!/usr/bin/env python3
"""
Load Network Rail CORPUS reference data into PostgreSQL.
This provides STANOX to location name mappings for the gap detector.
"""

import json
import psycopg2
from psycopg2.extras import execute_batch
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

def load_corpus_data(json_file: str, db_config: dict):
    """Load CORPUS JSON data into PostgreSQL."""
    
    print(f"Loading CORPUS data from {json_file}...")
    
    # Read JSON file
    with open(json_file, 'r') as f:
        data = json.load(f)
    
    tiploc_data = data.get('TIPLOCDATA', [])
    print(f"Found {len(tiploc_data)} TIPLOC records")
    
    # Connect to database
    conn = psycopg2.connect(**db_config)
    cur = conn.cursor()
    
    try:
        # Create schema if not exists
        schema_file = Path(__file__).parent.parent / 'local_infra' / 'corpus_schema.sql'
        if schema_file.exists():
            print("Creating/updating database schema...")
            with open(schema_file, 'r') as f:
                cur.execute(f.read())
            conn.commit()
        
        # Prepare data for insertion
        records = []
        for record in tiploc_data:
            nlc = record.get('NLC')
            stanox = record.get('STANOX', '').strip()
            tiploc = record.get('TIPLOC', '').strip()
            three_alpha = record.get('3ALPHA', '').strip()
            uic = record.get('UIC', '').strip()
            nlc_desc = record.get('NLCDESC', '').strip()
            nlc_desc_16 = record.get('NLCDESC16', '').strip()
            
            # Convert empty strings to None for cleaner data
            stanox = stanox if stanox and stanox != ' ' else None
            tiploc = tiploc if tiploc and tiploc != ' ' else None
            three_alpha = three_alpha if three_alpha and three_alpha != ' ' else None
            uic = uic if uic and uic != ' ' else None
            nlc_desc_16 = nlc_desc_16 if nlc_desc_16 and nlc_desc_16 != ' ' else None
            
            records.append((
                nlc, stanox, tiploc, three_alpha, uic, nlc_desc, nlc_desc_16
            ))
        
        # Clear existing data
        print("Clearing existing TIPLOC data...")
        cur.execute("TRUNCATE TABLE tiploc_reference")
        
        # Batch insert with conflict handling (keep first occurrence)
        print(f"Inserting {len(records)} records...")
        insert_sql = """
            INSERT INTO tiploc_reference
            (nlc, stanox, tiploc, three_alpha, uic, nlc_desc, nlc_desc_16)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (nlc) DO NOTHING
        """
        execute_batch(cur, insert_sql, records, page_size=1000)
        
        conn.commit()
        
        # Print statistics
        cur.execute("SELECT COUNT(*) FROM tiploc_reference")
        total = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM tiploc_reference WHERE stanox IS NOT NULL")
        with_stanox = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM active_locations")
        active = cur.fetchone()[0]
        
        print(f"\n✓ Successfully loaded CORPUS data:")
        print(f"  - Total records: {total}")
        print(f"  - Records with STANOX: {with_stanox}")
        print(f"  - Active locations: {active}")
        
        # Show some sample mappings
        print("\nSample STANOX mappings:")
        cur.execute("""
            SELECT stanox, three_alpha, location_name 
            FROM active_locations 
            WHERE three_alpha IS NOT NULL
            ORDER BY RANDOM()
            LIMIT 10
        """)
        for stanox, crs, name in cur.fetchall():
            print(f"  {stanox:6s} -> {crs:3s} {name}")
        
    except Exception as e:
        conn.rollback()
        print(f"✗ Error loading CORPUS data: {e}")
        raise
    finally:
        cur.close()
        conn.close()

def main():
    """Main entry point."""
    
    # Database configuration
    db_config = {
        'host': os.getenv('POSTGRES_HOST', 'localhost'),
        'port': int(os.getenv('POSTGRES_PORT', 5432)),
        'database': os.getenv('POSTGRES_DB', 'network_rail'),
        'user': os.getenv('POSTGRES_USER', 'postgres'),
        'password': os.getenv('POSTGRES_PASSWORD', 'postgres')
    }
    
    # Path to CORPUS JSON file
    corpus_file = Path(__file__).parent / 'CORPUSExtract.json'
    
    if not corpus_file.exists():
        print(f"✗ CORPUS file not found: {corpus_file}")
        print("Please ensure CORPUSExtract.json is in the timetable directory")
        return 1
    
    try:
        load_corpus_data(str(corpus_file), db_config)
        print("\n✓ CORPUS data loaded successfully!")
        return 0
    except Exception as e:
        print(f"\n✗ Failed to load CORPUS data: {e}")
        return 1

if __name__ == '__main__':
    exit(main())

