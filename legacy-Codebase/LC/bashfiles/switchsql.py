#!/usr/bin/env python

import RPi.GPIO as GPIO
import time
import mysql.connector

# Pin Definitions:
led_pin_1 = 13
led_pin_2 = 15
led_pin_3 = 19
led_pin_4 = 21

switch2 = 18
switch4 = 16

hdmi2in = 33
sdi2in = 31

but_pin = 7

def main():
    # Pin Setup:
    GPIO.setmode(GPIO.BOARD)  # BOARD pin-numbering scheme
    GPIO.setup([led_pin_1, led_pin_2, led_pin_3, led_pin_4, switch2, switch4], GPIO.OUT)  # LED pins set as output
    GPIO.setup([but_pin, hdmi2in, sdi2in], GPIO.IN)  # button pin set as input
    val=0

    mydb = mysql.connector.connect(
       host="localhost",
       user="root",
       password="ums8fhd",
       database="lc"
    )

    # Initial state for LEDs:
    GPIO.output(led_pin_1, GPIO.LOW)
    GPIO.output(led_pin_2, GPIO.LOW)
    GPIO.output(led_pin_3, GPIO.LOW)
    GPIO.output(led_pin_4, GPIO.LOW)
    GPIO.output(switch2, GPIO.LOW)
    GPIO.output(switch4, GPIO.LOW)

    print("Starting demo now! Press CTRL+C to exit")
    try:
        while True:
	    GPIO.wait_for_edge(but_pin, GPIO.FALLING)
	    val = val+1;
    	    if val == 4:
                val=0	
            if val == 0:#USB
                GPIO.output(led_pin_1, GPIO.HIGH)
                GPIO.output(led_pin_2, GPIO.LOW)
		GPIO.output(led_pin_3, GPIO.LOW)
		GPIO.output(led_pin_4, GPIO.LOW)

                mycursor = mydb.cursor()

		sql = "INSERT INTO indicators (name, value) VALUES (%s, %s)"
		valu = ("cambtn", "U")
		mycursor.execute(sql, valu)

		mydb.commit()
	
            if val == 1:#HDMI
                GPIO.output(led_pin_1, GPIO.LOW)
                GPIO.output(led_pin_2, GPIO.HIGH)
		GPIO.output(led_pin_3, GPIO.LOW)
		GPIO.output(led_pin_4, GPIO.LOW)
		
		value = GPIO.input(hdmi2in)
                mycursor = mydb.cursor()

		sql = "INSERT INTO indicators (name, value) VALUES (%s, %s)"
		valu = ("cambtn", "H")
		mycursor.execute(sql, valu)

		mydb.commit()

		if value != GPIO.HIGH:
		   GPIO.output(switch2, GPIO.HIGH)
		   time.sleep(0.2)
		   GPIO.output(switch2, GPIO.LOW)		

            if val == 2:#SDI
                GPIO.output(led_pin_1, GPIO.LOW)
                GPIO.output(led_pin_2, GPIO.LOW)
		GPIO.output(led_pin_3, GPIO.HIGH)
		GPIO.output(led_pin_4, GPIO.LOW)

		value2 = GPIO.input(sdi2in)
                mycursor = mydb.cursor()

		sql = "INSERT INTO indicators (name, value) VALUES (%s, %s)"
		valu = ("cambtn", "S")
		mycursor.execute(sql, valu)

		mydb.commit()

		if value2 != GPIO.HIGH:
		   GPIO.output(switch2, GPIO.HIGH)
		   time.sleep(0.2)
		   GPIO.output(switch2, GPIO.LOW)

            if val == 3:#RTSP
                GPIO.output(led_pin_1, GPIO.LOW)
                GPIO.output(led_pin_2, GPIO.LOW)
		GPIO.output(led_pin_3, GPIO.LOW)
		GPIO.output(led_pin_4, GPIO.HIGH)

                mycursor = mydb.cursor()

		sql = "INSERT INTO indicators (name, value) VALUES (%s, %s)"
		valu = ("cambtn", "R")
		mycursor.execute(sql, valu)

		mydb.commit()

            time.sleep(0.3)

    finally:
        GPIO.cleanup()  # cleanup all GPIOs

if __name__ == '__main__':
    main()
