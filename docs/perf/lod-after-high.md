# Geometry audit: quality high, renderer mobile, 1280x720

oasis memory: textures 93.7 MB, buffers 28.2 MB, video total 126.8 MB

## oasis / game view
GPU 0.95 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 108 | 85 + 19 | 85 + 19 | 722 + 995 |
| bushes | 1 | 1 + 2 | 1 + 2 | 33.4 + 78.4 |
| fauna | 19 | 14 + 1 | 14 + 1 | 9.1 + 23.8 |
| fighters | 56 | 40 + 5 | 40 + 5 | 151.7 + 110.1 |
| ground | 1 | 1 + 2 | 1 + 2 | 1.3 + 14.0 |
| lantern halos | 1 | 1 + 2 | 1 + 2 | 0.0 + 14.0 |
| light/weather/fx | 1 | 1 + 2 | 1 + 2 | 0.0 + 14.0 |
| other world | 3 | 3 + 2 | 3 + 2 | 0.7 + 14.0 |
| props | 4 | 4 + 6 | 4 + 6 | 92.5 + 199.0 |
| tree ring | 16 | 14 + 6 | 14 + 6 | 359.9 + 488.9 |
| walls | 2 | 2 + 4 | 2 + 4 | 67.1 + 148.1 |
| water+shore | 4 | 4 + 5 | 4 + 5 | 5.9 + 25.6 |

## oasis / edge view
GPU 0.90 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 108 | 81 + 14 | 81 + 14 | 687 + 951 |
| bushes | 1 | 1 + 1 | 1 + 1 | 33.4 + 66.9 |
| fauna | 19 | 12 + 1 | 12 + 1 | 6.9 + 13.4 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 98.6 |
| ground | 1 | 1 + 1 | 1 + 1 | 1.3 + 2.4 |
| lantern halos | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| light/weather/fx | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| other world | 3 | 3 + 1 | 3 + 1 | 0.7 + 2.4 |
| props | 4 | 4 + 3 | 4 + 3 | 92.5 + 131.1 |
| tree ring | 16 | 12 + 6 | 12 + 6 | 327.8 + 506.1 |
| walls | 2 | 2 + 4 | 2 + 4 | 67.1 + 136.7 |
| water+shore | 4 | 4 + 2 | 4 + 2 | 5.9 + 8.3 |

## oasis / menu view
GPU 1.04 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 108 | 78 + 20 | 78 + 20 | 769 + 1067 |
| bushes | 1 | 1 + 2 | 1 + 2 | 33.4 + 90.0 |
| fauna | 19 | 9 + 2 | 9 + 2 | 6.9 + 36.8 |
| fighters | 56 | 40 + 5 | 40 + 5 | 242.5 + 180.7 |
| ground | 1 | 1 + 2 | 1 + 2 | 1.3 + 25.5 |
| lantern halos | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| light/weather/fx | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| other world | 3 | 3 + 2 | 3 + 2 | 0.7 + 25.5 |
| props | 4 | 4 + 6 | 4 + 6 | 92.5 + 210.6 |
| tree ring | 16 | 12 + 6 | 12 + 6 | 318.1 + 500.4 |
| walls | 2 | 2 + 4 | 2 + 4 | 67.1 + 159.7 |
| water+shore | 4 | 4 + 5 | 4 + 5 | 5.9 + 37.2 |

dunes memory: textures 94.2 MB, buffers 27.7 MB, video total 128.9 MB

## dunes / game view
GPU 0.97 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 102 | 80 + 19 | 80 + 19 | 796 + 1060 |
| bushes | 1 | 1 + 2 | 1 + 2 | 16.7 + 45.0 |
| fauna | 7 | 5 + 1 | 5 + 1 | 4.6 + 18.5 |
| fighters | 56 | 40 + 5 | 40 + 5 | 151.7 + 110.1 |
| ground | 1 | 1 + 2 | 1 + 2 | 1.3 + 14.0 |
| lantern halos | 1 | 1 + 2 | 1 + 2 | 0.0 + 14.0 |
| light/weather/fx | 3 | 3 + 2 | 3 + 2 | 18.1 + 14.0 |
| other world | 1 | 1 + 2 | 1 + 2 | 0.0 + 14.0 |
| props | 6 | 6 + 8 | 6 + 8 | 105.8 + 225.5 |
| tree ring | 24 | 20 + 7 | 20 + 7 | 421.6 + 559.2 |
| walls | 2 | 2 + 4 | 2 + 4 | 76.4 + 166.7 |

## dunes / edge view
GPU 0.88 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 102 | 75 + 15 | 75 + 15 | 756 + 1022 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 16.7 |
| fauna | 7 | 1 + 0 | 1 + 0 | 0.7 + 6.9 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 98.6 |
| ground | 1 | 1 + 1 | 1 + 1 | 1.3 + 2.4 |
| lantern halos | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| light/weather/fx | 3 | 3 + 1 | 3 + 1 | 18.1 + 2.4 |
| other world | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| props | 6 | 6 + 4 | 6 + 4 | 105.8 + 177.3 |
| tree ring | 24 | 19 + 8 | 19 + 8 | 384.9 + 574.6 |
| walls | 2 | 2 + 4 | 2 + 4 | 76.4 + 155.2 |

## dunes / menu view
GPU 0.93 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 102 | 75 + 18 | 75 + 18 | 804 + 1071 |
| bushes | 1 | 1 + 2 | 1 + 2 | 16.7 + 56.6 |
| fauna | 7 | 5 + 1 | 5 + 1 | 11.0 + 36.5 |
| fighters | 56 | 40 + 5 | 40 + 5 | 242.5 + 180.7 |
| ground | 1 | 1 + 2 | 1 + 2 | 1.3 + 25.5 |
| lantern halos | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| light/weather/fx | 3 | 3 + 2 | 3 + 2 | 18.1 + 25.5 |
| other world | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| props | 6 | 6 + 8 | 6 + 8 | 105.8 + 237.1 |
| tree ring | 24 | 15 + 6 | 15 + 6 | 332.3 + 504.8 |
| walls | 2 | 2 + 4 | 2 + 4 | 76.4 + 178.3 |

grove memory: textures 96.2 MB, buffers 30.2 MB, video total 133.4 MB

## grove / game view
GPU 1.03 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 106 | 87 + 21 | 87 + 21 | 971 + 1341 |
| bushes | 1 | 1 + 2 | 1 + 2 | 123.5 + 258.6 |
| fauna | 16 | 15 + 4 | 15 + 4 | 25.1 + 38.8 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 107.7 |
| ground | 1 | 1 + 1 | 1 + 1 | 1.3 + 11.6 |
| lantern halos | 1 | 1 + 1 | 1 + 1 | 0.0 + 11.6 |
| light/weather/fx | 3 | 3 + 1 | 3 + 1 | 29.4 + 11.6 |
| other world | 1 | 1 + 1 | 1 + 1 | 0.0 + 11.6 |
| props | 5 | 5 + 5 | 5 + 5 | 89.2 + 184.6 |
| tree ring | 16 | 14 + 5 | 14 + 5 | 473.8 + 644.4 |
| walls | 2 | 2 + 3 | 2 + 3 | 65.6 + 142.9 |
| water+shore | 4 | 4 + 4 | 4 + 4 | 10.9 + 33.0 |

## grove / edge view
GPU 1.18 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 106 | 79 + 12 | 79 + 12 | 862 + 1246 |
| bushes | 1 | 1 + 1 | 1 + 1 | 123.5 + 247.1 |
| fauna | 16 | 9 + 0 | 9 + 0 | 14.2 + 23.8 |
| fighters | 56 | 40 + 3 | 40 + 3 | 151.7 + 96.2 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 2 | 5 + 2 | 89.2 + 122.7 |
| tree ring | 16 | 12 + 5 | 12 + 5 | 375.8 + 614.6 |
| walls | 2 | 2 + 3 | 2 + 3 | 65.6 + 131.4 |
| water+shore | 4 | 4 + 1 | 4 + 1 | 10.9 + 10.9 |

## grove / menu view
GPU 1.79 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 106 | 80 + 20 | 80 + 20 | 1021 + 1431 |
| bushes | 1 | 1 + 2 | 1 + 2 | 123.5 + 270.2 |
| fauna | 16 | 11 + 2 | 11 + 2 | 24.9 + 49.4 |
| fighters | 56 | 40 + 5 | 40 + 5 | 242.5 + 180.7 |
| ground | 1 | 1 + 2 | 1 + 2 | 1.3 + 25.5 |
| lantern halos | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| light/weather/fx | 3 | 3 + 2 | 3 + 2 | 29.4 + 25.5 |
| other world | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| props | 5 | 5 + 6 | 5 + 6 | 89.2 + 198.6 |
| tree ring | 16 | 11 + 6 | 11 + 6 | 433.5 + 677.0 |
| walls | 2 | 2 + 4 | 2 + 4 | 65.6 + 156.8 |
| water+shore | 4 | 4 + 5 | 4 + 5 | 10.9 + 47.0 |

frost memory: textures 94.8 MB, buffers 31.0 MB, video total 132.8 MB

## frost / game view
GPU 0.84 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 100 | 83 + 20 | 83 + 20 | 824 + 1159 |
| bushes | 1 | 1 + 3 | 1 + 3 | 46.9 + 107.4 |
| fauna | 20 | 20 + 4 | 20 + 4 | 27.9 + 43.6 |
| fighters | 56 | 40 + 6 | 40 + 6 | 151.7 + 112.2 |
| ground | 1 | 1 + 3 | 1 + 3 | 1.3 + 16.1 |
| lantern halos | 1 | 1 + 3 | 1 + 3 | 0.0 + 16.1 |
| light/weather/fx | 2 | 2 + 3 | 2 + 3 | 3.8 + 16.1 |
| other world | 1 | 1 + 3 | 1 + 3 | 0.0 + 16.1 |
| props | 5 | 5 + 8 | 5 + 8 | 80.5 + 177.0 |
| tree ring | 8 | 7 + 5 | 7 + 5 | 439.0 + 633.6 |
| walls | 2 | 2 + 5 | 2 + 5 | 62.3 + 140.8 |
| water+shore | 3 | 3 + 5 | 3 + 5 | 10.3 + 35.9 |

## frost / edge view
GPU 1.17 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 100 | 77 + 10 | 77 + 10 | 784 + 1016 |
| bushes | 1 | 1 + 1 | 1 + 1 | 46.9 + 93.7 |
| fauna | 20 | 14 + 0 | 14 + 0 | 13.1 + 17.7 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 98.6 |
| ground | 1 | 1 + 1 | 1 + 1 | 1.3 + 2.4 |
| lantern halos | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| light/weather/fx | 2 | 2 + 1 | 2 + 1 | 3.8 + 2.4 |
| other world | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| props | 5 | 5 + 3 | 5 + 3 | 80.5 + 118.9 |
| tree ring | 8 | 7 + 4 | 7 + 4 | 414.0 + 571.0 |
| walls | 2 | 2 + 3 | 2 + 3 | 62.3 + 113.9 |
| water+shore | 3 | 3 + 2 | 3 + 2 | 10.3 + 12.4 |

## frost / menu view
GPU 1.21 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 100 | 76 + 18 | 76 + 18 | 924 + 1280 |
| bushes | 1 | 1 + 3 | 1 + 3 | 46.9 + 119.0 |
| fauna | 20 | 14 + 2 | 14 + 2 | 19.3 + 44.9 |
| fighters | 56 | 40 + 6 | 40 + 6 | 242.5 + 182.9 |
| ground | 1 | 1 + 3 | 1 + 3 | 1.3 + 27.6 |
| lantern halos | 1 | 1 + 3 | 1 + 3 | 0.0 + 27.6 |
| light/weather/fx | 2 | 2 + 3 | 2 + 3 | 3.8 + 27.6 |
| other world | 1 | 1 + 3 | 1 + 3 | 0.0 + 27.6 |
| props | 5 | 5 + 8 | 5 + 8 | 80.5 + 188.6 |
| tree ring | 8 | 6 + 5 | 6 + 5 | 457.5 + 705.6 |
| walls | 2 | 2 + 5 | 2 + 5 | 62.3 + 152.3 |
| water+shore | 3 | 3 + 5 | 3 + 5 | 10.3 + 47.5 |

isles memory: textures 94.5 MB, buffers 31.2 MB, video total 132.8 MB

## isles / game view
GPU 0.50 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 103 | 80 + 15 | 80 + 15 | 273 + 297 |
| bushes | 1 | 1 + 2 | 1 + 2 | 34.1 + 79.7 |
| fauna | 17 | 17 + 1 | 17 + 1 | 15.6 + 26.7 |
| fighters | 56 | 40 + 5 | 40 + 5 | 151.7 + 110.1 |
| ground | 1 | 1 + 2 | 1 + 2 | 0.6 + 14.0 |
| light/weather/fx | 1 | 1 + 2 | 1 + 2 | 0.0 + 14.0 |
| map kit | 21 | 14 + 6 | 14 + 6 | 31.6 + 43.7 |
| props | 3 | 3 + 5 | 3 + 5 | 25.4 + 64.8 |
| walls | 1 | 1 + 3 | 1 + 3 | 6.3 + 26.5 |
| windmill | 2 | 2 + 3 | 2 + 3 | 7.2 + 24.8 |

## isles / edge view
GPU 0.41 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 103 | 77 + 9 | 77 + 9 | 266 + 268 |
| bushes | 1 | 1 + 1 | 1 + 1 | 34.1 + 68.2 |
| fauna | 17 | 13 + 0 | 13 + 0 | 9.3 + 12.6 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 98.6 |
| ground | 1 | 1 + 1 | 1 + 1 | 0.6 + 2.4 |
| light/weather/fx | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| map kit | 21 | 15 + 2 | 15 + 2 | 31.8 + 27.1 |
| props | 3 | 3 + 3 | 3 + 3 | 25.4 + 47.1 |
| walls | 1 | 1 + 2 | 1 + 2 | 6.3 + 14.9 |
| windmill | 2 | 2 + 1 | 2 + 1 | 7.2 + 9.6 |

## isles / menu view
GPU 0.45 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 103 | 75 + 15 | 75 + 15 | 360 + 368 |
| bushes | 1 | 1 + 2 | 1 + 2 | 34.1 + 91.3 |
| fauna | 17 | 13 + 1 | 13 + 1 | 12.9 + 37.9 |
| fighters | 56 | 40 + 5 | 40 + 5 | 242.5 + 180.7 |
| ground | 1 | 1 + 2 | 1 + 2 | 0.6 + 25.5 |
| light/weather/fx | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| map kit | 21 | 13 + 6 | 13 + 6 | 31.3 + 55.3 |
| props | 3 | 3 + 5 | 3 + 5 | 25.4 + 76.4 |
| walls | 1 | 1 + 3 | 1 + 3 | 6.3 + 38.0 |
| windmill | 2 | 2 + 3 | 2 + 3 | 7.2 + 36.3 |

marsh memory: textures 97.9 MB, buffers 31.1 MB, video total 136.0 MB

## marsh / game view
GPU 1.00 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 106 | 87 + 20 | 87 + 20 | 944 + 1317 |
| bushes | 1 | 1 + 2 | 1 + 2 | 94.8 + 201.1 |
| fauna | 13 | 12 + 3 | 12 + 3 | 12.0 + 24.0 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 107.7 |
| ground | 1 | 1 + 1 | 1 + 1 | 1.3 + 11.6 |
| lantern halos | 1 | 1 + 1 | 1 + 1 | 0.0 + 11.6 |
| light/weather/fx | 5 | 5 + 1 | 5 + 1 | 3.8 + 11.6 |
| other world | 1 | 1 + 1 | 1 + 1 | 0.0 + 11.6 |
| props | 6 | 6 + 5 | 6 + 5 | 96.3 + 191.7 |
| tree ring | 16 | 14 + 5 | 14 + 5 | 510.0 + 691.1 |
| walls | 2 | 2 + 3 | 2 + 3 | 60.4 + 132.4 |
| water+shore | 4 | 4 + 4 | 4 + 4 | 13.8 + 38.4 |

## marsh / edge view
GPU 0.92 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 106 | 82 + 14 | 82 + 14 | 811 + 1259 |
| bushes | 1 | 1 + 1 | 1 + 1 | 94.8 + 189.6 |
| fauna | 13 | 10 + 0 | 10 + 0 | 8.3 + 8.4 |
| fighters | 56 | 40 + 4 | 40 + 4 | 151.7 + 98.6 |
| ground | 1 | 1 + 1 | 1 + 1 | 1.3 + 2.4 |
| lantern halos | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| light/weather/fx | 5 | 5 + 1 | 5 + 1 | 3.8 + 2.4 |
| other world | 1 | 1 + 1 | 1 + 1 | 0.0 + 2.4 |
| props | 6 | 6 + 3 | 6 + 3 | 96.3 + 132.1 |
| tree ring | 16 | 11 + 6 | 11 + 6 | 381.0 + 703.0 |
| walls | 2 | 2 + 3 | 2 + 3 | 60.4 + 112.9 |
| water+shore | 4 | 4 + 4 | 4 + 4 | 13.8 + 24.2 |

## marsh / menu view
GPU 0.98 ms
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 106 | 85 + 22 | 85 + 22 | 980 + 1399 |
| bushes | 1 | 1 + 2 | 1 + 2 | 94.8 + 212.7 |
| fauna | 13 | 12 + 3 | 12 + 3 | 12.8 + 37.0 |
| fighters | 56 | 40 + 5 | 40 + 5 | 242.5 + 180.7 |
| ground | 1 | 1 + 2 | 1 + 2 | 1.3 + 25.5 |
| lantern halos | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| light/weather/fx | 5 | 5 + 2 | 5 + 2 | 3.8 + 25.5 |
| other world | 1 | 1 + 2 | 1 + 2 | 0.0 + 25.5 |
| props | 6 | 6 + 7 | 6 + 7 | 96.3 + 212.9 |
| tree ring | 16 | 12 + 6 | 12 + 6 | 454.5 + 705.0 |
| walls | 2 | 2 + 4 | 2 + 4 | 60.4 + 146.4 |
| water+shore | 4 | 4 + 5 | 4 + 5 | 13.8 + 52.4 |
