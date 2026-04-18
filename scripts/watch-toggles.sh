#!/usr/bin/env bash
# Continuously show the state of both Power Quick Toggles.
# Reads the same sources the extension reads, so this is ground truth.
#
# Usage:  ./watch-toggles.sh [interval_seconds]   (default 1)

set -u

INTERVAL="${1:-1}"
PL1=/sys/class/powercap/intel-rapl-mmio:0/constraint_0_power_limit_uw
PL2=/sys/class/powercap/intel-rapl-mmio:0/constraint_1_power_limit_uw
ULTRA_PROFILE="laptop-battery-powersave"
BOOST_THRESHOLD_UW=40000000

trap 'printf "\n"; exit 0' INT TERM

fmt_onoff() { [[ "$1" == "1" ]] && printf "\033[1;32mON \033[0m" || printf "\033[2;37moff\033[0m"; }
fmt_watts()  { awk -v v="$1" 'BEGIN { printf "%.0fW", v/1000000 }'; }

# clear screen + home cursor
printf "\033[2J"

while true; do
    # ask tuned for the active profile; strip the `s "..."` wrapper
    profile=$(busctl --system --no-pager call \
        com.redhat.tuned /Tuned com.redhat.tuned.control active_profile 2>/dev/null \
        | sed -E 's/^s "//; s/"$//')
    [[ -z "$profile" ]] && profile="(tuned not responding)"

    pl1=$(cat "$PL1" 2>/dev/null || echo 0)
    pl2=$(cat "$PL2" 2>/dev/null || echo 0)

    ups_on=0; [[ "$profile" == "$ULTRA_PROFILE" ]] && ups_on=1
    boost_on=0; (( pl1 > BOOST_THRESHOLD_UW )) && boost_on=1

    printf "\033[H"  # cursor home, no clear -> no flicker
    printf "%s\n\n" "$(date '+%Y-%m-%d %H:%M:%S')"
    printf "  Ultra PowerSaving : %b   tuned profile = %s\n" "$(fmt_onoff "$ups_on")" "$profile"
    printf "  GPU Boost         : %b   PL1 = %s  PL2 = %s\n" "$(fmt_onoff "$boost_on")" "$(fmt_watts "$pl1")" "$(fmt_watts "$pl2")"
    printf "\n  (Ctrl+C to exit; polling every %ss)\033[J\n" "$INTERVAL"

    sleep "$INTERVAL"
done
