#import "@local/modern-cug-report:0.1.3": *
#show: doc => template(doc, footer: "CUG水文气象学2026", header: "")

#let w1 = 2.5cm
#let cells = (
  [站点], [率定 ΔNSE], [率定 ΔKGE], [验证 ΔNSE], [验证 ΔKGE],
  [县河], "−0.062", "−0.030", "−0.018", "−0.046",
  [孤山], "−0.021", "−0.011", "+0.111", "+0.120",
  [延坝], "−0.012", "−0.006", "+0.008", "+0.014",
  [房县], "−0.041", "−0.019", "−0.019", "−0.028",
  [松柏（二）], "−0.015", "−0.008", "+0.027", "+0.017",
  [英山], "−0.041", "−0.022", "−0.035", "+0.006"
)

#figure(
  caption: [双向bar],
  table-bar(
    columns: (65pt, w1, w1, w1, w1),
    align: center,
    max: 0.1,
    side: "two",
    bar: (
      (column: 2),
      (column: 3, max: 0.2),
      (column: 4),
      (column: 5),
    ),
    ..cells,
  ),
) <table_>

#figure(
  caption: [单向bar],
  table-bar(
    columns: (65pt, w1, w1, w1, w1),
    align: center,
    max: 0.15,
    side: "one",
    bar: (
      (column: 2),
      (column: 3, max: 0.3),
      (column: 4),
      (column: 5),
    ),
    ..cells,
  ),
) <table_>
