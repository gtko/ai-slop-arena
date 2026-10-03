# Models

| model | tris | verts | surfaces | LOD levels per surface | bones | blend shapes |
|---|---:|---:|---:|---|---:|---:|
| blaster.glb | 43172 | 33154 | 2 | 3 / 4 | 24 | 0 |
| bomber.glb | 23107 | 16943 | 2 | 4 / 4 | 24 | 0 |
| frostbite.glb | 33238 | 25843 | 2 | 4 / 4 | 24 | 0 |
| gunslinger.glb | 23543 | 17807 | 3 | 3 / 3 / 4 | 26 | 0 |
| kappa.glb | 24246 | 19057 | 2 | 3 / 4 | 24 | 0 |
| mochi.glb | 20982 | 16321 | 2 | 3 / 4 | 24 | 0 |
| pipchomp.glb | 23702 | 17870 | 2 | 3 / 4 | 24 | 0 |
| volt.glb | 25958 | 20570 | 1 | 4 | 22 | 0 |
| decor/boulder.glb | 1800 | 5400 | 1 | 2 | 0 | 0 |
| decor/boulder_snow.glb | 1800 | 5395 | 1 | 3 | 0 | 0 |
| decor/bush.glb | 1065 | 3195 | 1 | 0 | 0 | 0 |
| decor/cactus.glb | 1500 | 4498 | 1 | 1 | 0 | 0 |
| decor/crate.glb | 2400 | 7200 | 1 | 1 | 0 | 0 |
| decor/lantern.glb | 3000 | 9000 | 1 | 1 | 0 | 0 |
| decor/rock_canyon.glb | 1050 | 3150 | 1 | 2 | 0 | 0 |
| decor/stump.glb | 1800 | 5400 | 1 | 2 | 0 | 0 |
| decor/tree_dead.glb | 1500 | 4500 | 1 | 1 | 0 | 0 |
| decor/tree_pine.glb | 1500 | 4500 | 1 | 3 | 0 | 0 |
| decor/tree_pine_snow.glb | 1500 | 4500 | 1 | 3 | 0 | 0 |
| decor/tree_round.glb | 1500 | 4500 | 1 | 2 | 0 | 0 |
| decor/wall_canyon.glb | 516 | 1548 | 1 | 1 | 0 | 0 |
| decor/wall_ice.glb | 511 | 1523 | 1 | 2 | 0 | 0 |
| decor/wall_moss.glb | 521 | 1563 | 1 | 0 | 0 | 0 |
| decor/windmill.glb | 3600 | 10800 | 1 | 2 | 0 | 0 |
| decor/windmill_sails.glb | 3600 | 10800 | 1 | 1 | 0 | 0 |
| fauna/arctic_fox.glb | 5742 | 5248 | 1 | 2 | 21 | 0 |
| fauna/cat.glb | 5742 | 4323 | 1 | 4 | 21 | 0 |
| fauna/duck.glb | 5942 | 4773 | 1 | 3 | 17 | 0 |
| fauna/fennec.glb | 5742 | 4516 | 1 | 3 | 23 | 0 |
| fauna/frog.glb | 5600 | 4390 | 1 | 3 | 19 | 0 |
| fauna/hare.glb | 5600 | 4223 | 1 | 3 | 21 | 0 |
| fauna/hedgehog.glb | 5742 | 8078 | 1 | 1 | 18 | 0 |
| fauna/hen.glb | 5294 | 4347 | 1 | 3 | 17 | 0 |
| fauna/lizard.glb | 5683 | 4399 | 1 | 3 | 23 | 0 |
| fauna/penguin.glb | 5600 | 4056 | 1 | 3 | 17 | 0 |
| fauna/raven.glb | 5683 | 4807 | 1 | 3 | 11 | 0 |
| fauna/sparrow.glb | 5192 | 4111 | 1 | 3 | 17 | 0 |
| fauna/squirrel.glb | 5600 | 4975 | 1 | 2 | 23 | 0 |
| fauna/vulture.glb | 5684 | 4199 | 1 | 3 | 11 | 0 |
# Geometry audit: quality low, renderer mobile, 1280x720

## oasis / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 94 | 62 + 0 | 62 + 0 | 163 + 0 |
| bushes | 1 | 2 + 0 | 2 + 0 | 39.1 + 0.0 |
| fauna | 19 | 9 + 0 | 9 + 0 | 16.8 + 0.0 |
| fighters | 56 | 19 + 0 | 19 + 0 | 95.2 + 0.0 |
| ground | 1 | 2 + 0 | 2 + 0 | 6.9 + 0.0 |
| lantern halos | 1 | 2 + 0 | 2 + 0 | 5.7 + 0.0 |
| light/weather/fx | 1 | 2 + 0 | 2 + 0 | 5.7 + 0.0 |
| other world | 3 | 4 + 0 | 4 + 0 | 6.4 + 0.0 |
| props | 4 | 5 + 0 | 5 + 0 | 14.2 + 0.0 |
| tree ring | 2 | 3 + 0 | 3 + 0 | 8.2 + 0.0 |
| walls | 2 | 3 + 0 | 3 + 0 | 6.7 + 0.0 |
| water+shore | 4 | 5 + 0 | 5 + 0 | 11.6 + 0.0 |

## oasis / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 94 | 60 + 0 | 60 + 0 | 151 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 33.4 + 0.0 |
| fauna | 19 | 7 + 0 | 7 + 0 | 5.2 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| other world | 3 | 3 + 0 | 3 + 0 | 0.7 + 0.0 |
| props | 4 | 4 + 0 | 4 + 0 | 8.5 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 2.5 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 1.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 5.9 + 0.0 |

## oasis / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 94 | 59 + 0 | 59 + 0 | 208 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 33.4 + 0.0 |
| fauna | 19 | 6 + 0 | 6 + 0 | 4.2 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 147.7 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| other world | 3 | 3 + 0 | 3 + 0 | 0.7 + 0.0 |
| props | 4 | 4 + 0 | 4 + 0 | 8.5 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 2.5 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 1.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 5.9 + 0.0 |

## dunes / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 81 | 56 + 0 | 56 + 0 | 161 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 0.0 |
| fauna | 7 | 4 + 0 | 4 + 0 | 14.3 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 18.1 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 13.1 + 0.0 |
| tree ring | 3 | 3 + 0 | 3 + 0 | 4.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 1.0 + 0.0 |

## dunes / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 81 | 52 + 0 | 52 + 0 | 147 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 0.0 |
| fauna | 7 | 0 + 0 | 0 + 0 | 0.0 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 18.1 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 13.1 + 0.0 |
| tree ring | 3 | 3 + 0 | 3 + 0 | 4.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 1.0 + 0.0 |

## dunes / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 81 | 56 + 0 | 56 + 0 | 219 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 0.0 |
| fauna | 7 | 4 + 0 | 4 + 0 | 14.3 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 147.7 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 18.1 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 13.1 + 0.0 |
| tree ring | 3 | 3 + 0 | 3 + 0 | 4.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 1.0 + 0.0 |

## grove / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 92 | 63 + 0 | 63 + 0 | 364 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 123.5 + 0.0 |
| fauna | 16 | 9 + 0 | 9 + 0 | 26.7 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 11.2 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 65.6 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 10.9 + 0.0 |

## grove / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 92 | 58 + 0 | 58 + 0 | 353 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 123.5 + 0.0 |
| fauna | 16 | 4 + 0 | 4 + 0 | 14.9 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 11.2 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 65.6 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 10.9 + 0.0 |

## grove / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 92 | 61 + 0 | 61 + 0 | 417 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 123.5 + 0.0 |
| fauna | 16 | 7 + 0 | 7 + 0 | 21.2 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 147.7 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 11.2 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 65.6 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 10.9 + 0.0 |

## frost / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 93 | 61 + 0 | 61 + 0 | 193 + 0 |
| bushes | 1 | 0 + 0 | 0 + 0 | 44.6 + 0.0 |
| fauna | 20 | 10 + 0 | 10 + 0 | 25.5 + 0.0 |
| fighters | 56 | 17 + 0 | 17 + 0 | 87.3 + 0.0 |
| ground | 1 | 0 + 0 | 0 + 0 | -1.0 + 0.0 |
| lantern halos | 1 | 0 + 0 | 0 + 0 | -2.2 + 0.0 |
| light/weather/fx | 2 | 1 + 0 | 1 + 0 | 1.5 + 0.0 |
| other world | 1 | 0 + 0 | 0 + 0 | -2.3 + 0.0 |
| props | 5 | 4 + 0 | 4 + 0 | 8.0 + 0.0 |
| tree ring | 1 | 0 + 0 | 0 + 0 | -0.8 + 0.0 |
| walls | 2 | 1 + 0 | 1 + 0 | -1.2 + 0.0 |
| water+shore | 3 | 2 + 0 | 2 + 0 | 8.1 + 0.0 |

## frost / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 93 | 58 + 0 | 58 + 0 | 185 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 46.9 + 0.0 |
| fauna | 20 | 7 + 0 | 7 + 0 | 17.3 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 2 | 2 + 0 | 2 + 0 | 3.8 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 5 | 4 + 0 | 4 + 0 | 9.1 + 0.0 |
| tree ring | 1 | 0 + 0 | 0 + 0 | 0.4 + 0.0 |
| walls | 2 | 1 + 0 | 1 + 0 | -0.1 + 0.0 |
| water+shore | 3 | 2 + 0 | 2 + 0 | 7.1 + 0.0 |

## frost / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 93 | 59 + 0 | 59 + 0 | 248 + 0 |
| bushes | 1 | 0 + 0 | 0 + 0 | 45.7 + 0.0 |
| fauna | 20 | 8 + 0 | 8 + 0 | 22.6 + 0.0 |
| fighters | 56 | 17 + 0 | 17 + 0 | 146.5 + 0.0 |
| ground | 1 | 0 + 0 | 0 + 0 | 0.1 + 0.0 |
| lantern halos | 1 | 0 + 0 | 0 + 0 | -1.2 + 0.0 |
| light/weather/fx | 2 | 1 + 0 | 1 + 0 | 2.6 + 0.0 |
| other world | 1 | 0 + 0 | 0 + 0 | -1.2 + 0.0 |
| props | 5 | 4 + 0 | 4 + 0 | 9.1 + 0.0 |
| tree ring | 1 | 1 + 0 | 1 + 0 | 1.5 + 0.0 |
| walls | 2 | 1 + 0 | 1 + 0 | -0.2 + 0.0 |
| water+shore | 3 | 2 + 0 | 2 + 0 | 9.1 + 0.0 |

## isles / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 103 | 68 + 0 | 68 + 0 | 200 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 34.1 + 0.0 |
| fauna | 17 | 11 + 0 | 11 + 0 | 19.0 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 0.6 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| map kit | 21 | 14 + 0 | 14 + 0 | 31.6 + 0.0 |
| props | 3 | 3 + 0 | 3 + 0 | 8.6 + 0.0 |
| walls | 1 | 1 + 0 | 1 + 0 | 6.3 + 0.0 |
| windmill | 2 | 2 + 0 | 2 + 0 | 7.2 + 0.0 |

## isles / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 103 | 67 + 0 | 67 + 0 | 190 + 0 |
| bushes | 1 | 2 + 0 | 2 + 0 | 34.1 + 0.0 |
| fauna | 17 | 9 + 0 | 9 + 0 | 8.8 + 0.0 |
| fighters | 56 | 19 + 0 | 19 + 0 | 89.6 + 0.0 |
| ground | 1 | 2 + 0 | 2 + 0 | 0.7 + 0.0 |
| light/weather/fx | 1 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| map kit | 21 | 16 + 0 | 16 + 0 | 31.9 + 0.0 |
| props | 3 | 4 + 0 | 4 + 0 | 8.7 + 0.0 |
| walls | 1 | 2 + 0 | 2 + 0 | 6.3 + 0.0 |
| windmill | 2 | 3 + 0 | 3 + 0 | 7.2 + 0.0 |

## isles / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 103 | 65 + 0 | 65 + 0 | 254 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 34.1 + 0.0 |
| fauna | 17 | 9 + 0 | 9 + 0 | 14.9 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 147.7 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 0.6 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| map kit | 21 | 13 + 0 | 13 + 0 | 31.3 + 0.0 |
| props | 3 | 3 + 0 | 3 + 0 | 8.6 + 0.0 |
| walls | 1 | 1 + 0 | 1 + 0 | 6.3 + 0.0 |
| windmill | 2 | 2 + 0 | 2 + 0 | 7.2 + 0.0 |

## marsh / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 92 | 63 + 0 | 63 + 0 | 288 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 94.8 + 0.0 |
| fauna | 13 | 8 + 0 | 8 + 0 | 7.9 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 5 | 3 + 0 | 3 + 0 | 1.0 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 12.9 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 60.4 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 13.8 + 0.0 |

## marsh / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 92 | 62 + 0 | 62 + 0 | 286 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 94.8 + 0.0 |
| fauna | 13 | 7 + 0 | 7 + 0 | 5.8 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 89.5 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 5 | 3 + 0 | 3 + 0 | 1.0 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 12.9 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 60.4 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 13.8 + 0.0 |

## marsh / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 92 | 63 + 0 | 63 + 0 | 346 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 94.8 + 0.0 |
| fauna | 13 | 8 + 0 | 8 + 0 | 7.9 + 0.0 |
| fighters | 56 | 18 + 0 | 18 + 0 | 147.7 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| light/weather/fx | 5 | 3 + 0 | 3 + 0 | 1.0 + 0.0 |
| other world | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 12.9 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 60.4 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 13.8 + 0.0 |
