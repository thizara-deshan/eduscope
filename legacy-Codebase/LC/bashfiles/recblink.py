#!/usr/bin/env python

import RPi.GPIO as GPIO
import time

# Pin Definitions:
led_pin_1 = 23


def main():
    # Pin Setup:
    GPIO.setmode(GPIO.BOARD)  # BOARD pin-numbering scheme
    GPIO.setup(led_pin_1, GPIO.OUT)  # LED pins set as output

    # Initial state for LEDs:
    GPIO.output(led_pin_1, GPIO.LOW)

    try:
        while True:
            # blink LED 1 slowly
              GPIO.output(led_pin_1, GPIO.HIGH)
              time.sleep(1)
              GPIO.output(led_pin_1, GPIO.LOW)
              time.sleep(1)
    finally:
        GPIO.cleanup()  # cleanup all GPIOs

if __name__ == '__main__':
    main()
