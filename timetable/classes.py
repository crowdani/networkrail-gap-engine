from __future__ import annotations
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import declarative_base, relationship, Mapped, mapped_column, Session
from sqlalchemy import (
    Column, Integer, String, Date, ForeignKey, create_engine, Index
)
from typing import Optional

from datetime import date
import uuid


def to_orm(schedule_dict: dict) -> TrainScheduleORM:
    # parse dates
    start = date.fromisoformat(schedule_dict["schedule_start_date"])
    end = date.fromisoformat(schedule_dict["schedule_end_date"])

    seg = schedule_dict["schedule_segment"]
    new_seg = schedule_dict.get("new_schedule_segment", {})  # may be missing
    try:
        orm = TrainScheduleORM(
            db_uuid=str(uuid.uuid4()),
            CIF_train_uid=schedule_dict["CIF_train_uid"],
            CIF_bank_holiday_running=schedule_dict.get("CIF_bank_holiday_running"),
            CIF_stp_indicator=schedule_dict["CIF_stp_indicator"],
            applicable_timetable=schedule_dict.get("applicable_timetable"),
            atoc_code=schedule_dict.get("atoc_code"),
            schedule_days_runs=schedule_dict["schedule_days_runs"],
            schedule_end_date=end,
            schedule_start_date=start,
            train_status=schedule_dict["train_status"],
            transaction_type=schedule_dict["transaction_type"],

            traction_class=new_seg.get("traction_class", ""),
            uic_code=new_seg.get("uic_code", ""),

            signalling_id=seg["signalling_id"],
            CIF_train_service_code=seg["CIF_train_service_code"],
            CIF_power_type=seg["CIF_power_type"],
            CIF_timing_load=seg["CIF_timing_load"],
            CIF_speed=seg["CIF_speed"],
            CIF_operating_characteristics=seg["CIF_operating_characteristics"],
            CIF_train_class=seg["CIF_train_class"],
            CIF_business_sector=seg["CIF_business_sector"],
            CIF_headcode=seg.get("CIF_headcode", ""),
            CIF_reservations=seg.get("CIF_reservations"),
            CIF_connection_indicator=seg.get("CIF_connection_indicator"),
            CIF_catering_code=seg.get("CIF_catering_code"),
            CIF_service_branding=seg.get("CIF_service_branding", ""),
            CIF_course_indicator=int(seg["CIF_course_indicator"]),
        )

        orm.locations = [
            ScheduleLocationORM(
                CIF_train_uid=schedule_dict["CIF_train_uid"],
                location_type=loc["location_type"],
                record_identity=loc["record_identity"],
                tiploc_code=loc["tiploc_code"],
                tiploc_instance=loc.get("tiploc_instance"),
                departure=loc.get("departure"),
                public_departure=loc.get("public_departure"),
                platform=loc.get("platform"),
                line=loc.get("line"),
                engineering_allowance=loc.get("engineering_allowance"),
                pathing_allowance=loc.get("pathing_allowance"),
                performance_allowance=loc.get("performance_allowance"),
                pass_=loc.get("pass")
            )
            for loc in seg.get("schedule_location", [])
        ]
        return orm
    except Exception as e:
        print(f"Error parsing schedule: {e}")
        print(schedule_dict)
        exit(1)


Base = declarative_base()


class TrainScheduleORM(Base):
    __tablename__ = "train_schedules"

    # Use the unique UID as natural primary key (you can switch to surrogate if preferred)
    db_uuid: Mapped[str] = mapped_column(String, primary_key=True)
    CIF_train_uid: Mapped[str] = mapped_column(String)

    CIF_bank_holiday_running: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_stp_indicator: Mapped[str] = mapped_column(String, nullable=False)
    applicable_timetable: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    atoc_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    schedule_days_runs: Mapped[str] = mapped_column(String, nullable=False)
    schedule_end_date: Mapped[Optional[str]] = mapped_column(Date, nullable=False)
    schedule_start_date: Mapped[Optional[str]] = mapped_column(Date, nullable=False)
    train_status: Mapped[str] = mapped_column(String, nullable=False)
    transaction_type: Mapped[str] = mapped_column(String, nullable=False)

    traction_class: Mapped[str] = mapped_column(String, nullable=False, default="")
    uic_code: Mapped[str] = mapped_column(String, nullable=False, default="")

    # Flattened key fields from schedule_segment (add more as needed)
    signalling_id: Mapped[str] = mapped_column(String, nullable=False)
    CIF_train_service_code: Mapped[str] = mapped_column(String, nullable=False)
    CIF_power_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_timing_load: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_speed: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_operating_characteristics: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_train_class: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_business_sector: Mapped[str] = mapped_column(String, nullable=False)
    CIF_headcode: Mapped[str] = mapped_column(String, nullable=False, default="")
    CIF_reservations: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_connection_indicator: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_catering_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    CIF_service_branding: Mapped[str] = mapped_column(String, nullable=False, default="")
    CIF_course_indicator: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationship to locations
    locations: Mapped[list[ScheduleLocationORM]] = relationship(
        "ScheduleLocationORM",
        back_populates="train",
        cascade="all, delete-orphan"
    )


class ScheduleLocationORM(Base):
    __tablename__ = "schedule_locations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    CIF_train_uid: Mapped[str] = mapped_column(
        String,
        nullable=False,
        index=False
    )
    db_uuid: Mapped[str] = mapped_column(ForeignKey("train_schedules.db_uuid", ondelete="CASCADE"), nullable=False)

    location_type: Mapped[str] = mapped_column(String, nullable=False)
    record_identity: Mapped[str] = mapped_column(String, nullable=False)
    tiploc_code: Mapped[str] = mapped_column(String, nullable=False)
    tiploc_instance: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    departure: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    public_departure: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    platform: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    line: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    engineering_allowance: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pathing_allowance: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    performance_allowance: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    arrival: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    public_arrival: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pass_: Mapped[Optional[str]] = mapped_column(String, name="pass",  nullable=True)
    path: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    train: Mapped[TrainScheduleORM] = relationship("TrainScheduleORM", back_populates="locations")


class Tiploc(Base):
    __tablename__ = "tiploc"
    transaction_type = Column(String(20))
    tiploc_code = Column(String(20), primary_key=True)
    nalco = Column(String(20))
    stanox = Column(String(20), nullable=True)
    crs_code = Column(String(10), nullable=True)
    description = Column(String(512))
    tps_description = Column(String(512))
