import { useState, type CSSProperties } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const formatDateTextInput = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
};

export const parseDateValue = (value?: string | null) => {
  if (!value || !DATE_PATTERN.test(value)) return undefined;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
};

export const formatDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const isValidDateValue = (value?: string | null) => {
  if (!value) return true;
  return Boolean(parseDateValue(value));
};

const dateTime = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const isSameDate = (a: Date, b: Date) => dateTime(a) === dateTime(b);

const getOrderedRange = (from: Date, to: Date): DateRange => {
  return dateTime(from) <= dateTime(to) ? { from, to } : { from: to, to: from };
};

type DateTextInputProps = {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
};

const DateTextInput = ({
  value,
  onChange,
  placeholder = "YYYY-MM-DD",
  disabled = false,
  className,
  style,
}: DateTextInputProps) => (
  <input
    type="text"
    inputMode="numeric"
    placeholder={placeholder}
    maxLength={10}
    value={value ?? ""}
    disabled={disabled}
    onFocus={(event) => event.currentTarget.select()}
    onChange={(event) => onChange(formatDateTextInput(event.target.value))}
    className={cn(
      "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    style={style}
  />
);

type DatePickerProps = {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  align?: "start" | "center" | "end";
};

const DatePicker = ({
  value,
  onChange,
  placeholder = "날짜 선택",
  disabled = false,
  className,
  style,
  align = "start",
}: DatePickerProps) => {
  const [open, setOpen] = useState(false);
  const [calendarValue, setCalendarValue] = useState<Date | undefined>(undefined);

  return (
    <div className={cn("flex w-full items-center gap-1", className)} style={style}>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setCalendarValue(undefined);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            className="h-9 w-9 shrink-0"
            aria-label="날짜 선택"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            mode="single"
            selected={calendarValue}
            onSelect={(date) => {
              if (!date) return;
              setCalendarValue(date);
              onChange(formatDateValue(date));
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <DateTextInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
};

type DateRangePickerProps = {
  startValue?: string | null;
  endValue?: string | null;
  onChange: (range: { startDate: string; endDate: string }) => void;
  startPlaceholder?: string;
  endPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  align?: "start" | "center" | "end";
};

const DateRangePicker = ({
  startValue,
  endValue,
  onChange,
  startPlaceholder = "시작일",
  endPlaceholder = "종료일",
  disabled = false,
  className,
  style,
  align = "start",
}: DateRangePickerProps) => {
  const [open, setOpen] = useState(false);
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(undefined);
  const [hoverDate, setHoverDate] = useState<Date | undefined>(undefined);
  const previewRange =
    calendarRange?.from && !calendarRange.to && hoverDate
      ? getOrderedRange(calendarRange.from, hoverDate)
      : undefined;
  const previewMiddle: { after: Date; before: Date } | Date[] =
    previewRange?.from && previewRange.to && !isSameDate(previewRange.from, previewRange.to)
      ? { after: previewRange.from, before: previewRange.to }
      : [];

  const updateRange = (nextStartDate: string, nextEndDate: string) => {
    onChange({ startDate: nextStartDate, endDate: nextEndDate });
  };

  return (
    <div className={cn("flex w-full items-center gap-1", className)} style={style}>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setCalendarRange(undefined);
            setHoverDate(undefined);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            className="h-9 w-9 shrink-0"
            aria-label="기간 선택"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            mode="range"
            selected={calendarRange}
            modifiers={{
              range_preview_start: previewRange?.from ?? [],
              range_preview_middle: previewMiddle,
              range_preview_end: previewRange?.to ?? [],
            }}
            modifiersClassNames={{
              range_preview_start:
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              range_preview_middle:
                "rounded-none bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
              range_preview_end:
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
            }}
            onDayMouseEnter={(date) => {
              if (calendarRange?.from && !calendarRange.to) setHoverDate(date);
            }}
            onDayMouseLeave={() => {
              setHoverDate(undefined);
            }}
            onSelect={(range) => {
              setCalendarRange(range);
              setHoverDate(undefined);
              const nextStartDate = range?.from ? formatDateValue(range.from) : "";
              const nextEndDate = range?.to ? formatDateValue(range.to) : "";
              updateRange(nextStartDate, nextEndDate);
              if (range?.from && range?.to) setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <DateTextInput
        value={startValue}
        onChange={(value) => updateRange(value, endValue ?? "")}
        placeholder={startPlaceholder}
        disabled={disabled}
      />
      <span className="shrink-0 text-xs text-muted-foreground">~</span>
      <DateTextInput
        value={endValue}
        onChange={(value) => updateRange(startValue ?? "", value)}
        placeholder={endPlaceholder}
        disabled={disabled}
      />
    </div>
  );
};

export { DatePicker, DateRangePicker };
