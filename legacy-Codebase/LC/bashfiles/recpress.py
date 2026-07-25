#!/usr/bin/env python

import RPi.GPIO as GPIO
import time
import mysql.connector
from tendo import singleton

try:
    me = singleton.SingleInstance()
except:
    print("Already running")
    sys.exit(-1)

# Pin Definitions:
but_pin = 15

press=0

def main():
    # Pin Setup:
    GPIO.setmode(GPIO.BOARD)  # BOARD pin-numbering scheme
    GPIO.setup(but_pin, GPIO.IN)  # button pin set as input

    mydb = mysql.connector.connect(
       host="localhost",
       user="root",
       password="Ums8fhd!",
       database="lc"
    )

    print("Starting demo now! Press CTRL+C to exit")
    try:
        while True:
            GPIO.wait_for_edge(but_pin, GPIO.FALLING)
            mycursor = mydb.cursor()
            sql = "UPDATE record_status SET status=0 where record=1"
            mycursor.execute(sql)
            mydb.commit()
            time.sleep(0.1)				
    finally:
        GPIO.cleanup()  # cleanup all GPIOs

if __name__ == '__main__':
    main()
