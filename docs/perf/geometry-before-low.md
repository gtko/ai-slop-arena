# Models

| model | tris | verts | surfaces | LOD levels per surface | bones | blend shapes |
|---|---:|---:|---:|---|---:|---:|
| blaster.glb | 43172 | 129516 | 2 | 3 / 4 | 24 | 0 |
| bomber.glb | 23107 | 69321 | 2 | 4 / 4 | 24 | 0 |
| frostbite.glb | 33238 | 99714 | 2 | 4 / 3 | 24 | 0 |
| gunslinger.glb | 23543 | 70629 | 3 | 3 / 3 / 4 | 26 | 0 |
| kappa.glb | 24246 | 72738 | 2 | 3 / 4 | 24 | 0 |
| mochi.glb | 20982 | 62946 | 2 | 3 / 4 | 24 | 0 |
| pipchomp.glb | 23702 | 71106 | 2 | 3 / 4 | 24 | 0 |
| volt.glb | 25958 | 77874 | 1 | 4 | 22 | 0 |
| decor/boulder.glb | 1800 | 5400 | 1 | 2 | 0 | 0 |
| decor/boulder_snow.glb | 1800 | 5400 | 1 | 3 | 0 | 0 |
| decor/bush.glb | 3582 | 10746 | 1 | 0 | 0 | 0 |
| decor/cactus.glb | 1500 | 4500 | 1 | 1 | 0 | 0 |
| decor/crate.glb | 2400 | 7200 | 1 | 1 | 0 | 0 |
| decor/lantern.glb | 3000 | 9000 | 1 | 1 | 0 | 0 |
| decor/rock_canyon.glb | 1050 | 3150 | 1 | 2 | 0 | 0 |
| decor/stump.glb | 1800 | 5400 | 1 | 2 | 0 | 0 |
| decor/tree_dead.glb | 1500 | 4500 | 1 | 1 | 0 | 0 |
| decor/tree_pine.glb | 1500 | 4500 | 1 | 3 | 0 | 0 |
| decor/tree_pine_snow.glb | 1500 | 4500 | 1 | 3 | 0 | 0 |
| decor/tree_round.glb | 1500 | 4500 | 1 | 2 | 0 | 0 |
| decor/wall_canyon.glb | 1498 | 4494 | 1 | 2 | 0 | 0 |
| decor/wall_ice.glb | 1500 | 4500 | 1 | 3 | 0 | 0 |
| decor/wall_moss.glb | 1500 | 4500 | 1 | 0 | 0 | 0 |
| decor/windmill.glb | 3600 | 10800 | 1 | 2 | 0 | 0 |
| decor/windmill_sails.glb | 3600 | 10800 | 1 | 1 | 0 | 0 |
| fauna/arctic_fox.glb | 5742 | 17226 | 1 | 2 | 21 | 0 |
| fauna/cat.glb | 5742 | 17226 | 1 | 3 | 21 | 0 |
| fauna/duck.glb | 5942 | 17826 | 1 | 3 | 17 | 0 |
| fauna/fennec.glb | 5742 | 17226 | 1 | 3 | 23 | 0 |
| fauna/frog.glb | 5600 | 16800 | 1 | 3 | 19 | 0 |
| fauna/hare.glb | 5600 | 16800 | 1 | 3 | 21 | 0 |
| fauna/hedgehog.glb | 5742 | 17226 | 1 | 1 | 18 | 0 |
| fauna/hen.glb | 5294 | 15882 | 1 | 3 | 17 | 0 |
| fauna/lizard.glb | 5683 | 17049 | 1 | 3 | 23 | 0 |
| fauna/penguin.glb | 5600 | 16800 | 1 | 3 | 17 | 0 |
| fauna/raven.glb | 5683 | 17049 | 1 | 2 | 11 | 0 |
| fauna/sparrow.glb | 5192 | 15576 | 1 | 3 | 17 | 0 |
| fauna/squirrel.glb | 5600 | 16800 | 1 | 2 | 23 | 0 |
| fauna/vulture.glb | 5684 | 17052 | 1 | 3 | 11 | 0 |
# Geometry audit: quality low, renderer mobile, 1280x720

## oasis / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 118 | 90 + 0 | 90 + 0 | 221 + 0 |
| bushes | 1 | 2 + 0 | 2 + 0 | 39.1 + 0.0 |
| fauna | 19 | 9 + 0 | 9 + 0 | 16.8 + 0.0 |
| fighters | 56 | 33 + 0 | 33 + 0 | 151.7 + 0.0 |
| ground | 1 | 2 + 0 | 2 + 0 | 6.9 + 0.0 |
| lantern halos | 22 | 15 + 0 | 15 + 0 | 5.7 + 0.0 |
| light/weather/fx | 1 | 2 + 0 | 2 + 0 | 5.7 + 0.0 |
| other world | 2 | 3 + 0 | 3 + 0 | 6.4 + 0.0 |
| outer ground | 4 | 3 + 0 | 3 + 0 | 5.7 + 0.0 |
| props | 4 | 5 + 0 | 5 + 0 | 14.2 + 0.0 |
| tree ring | 2 | 3 + 0 | 3 + 0 | 8.2 + 0.0 |
| walls | 2 | 3 + 0 | 3 + 0 | 8.7 + 0.0 |
| water+shore | 4 | 5 + 0 | 5 + 0 | 11.6 + 0.0 |

## oasis / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 118 | 90 + 0 | 90 + 0 | 210 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 33.4 + 0.0 |
| fauna | 19 | 7 + 0 | 7 + 0 | 5.2 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 22 | 15 + 0 | 15 + 0 | 0.0 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| other world | 2 | 2 + 0 | 2 + 0 | 0.7 + 0.0 |
| outer ground | 4 | 3 + 0 | 3 + 0 | 0.0 + 0.0 |
| props | 4 | 4 + 0 | 4 + 0 | 8.5 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 2.5 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 5.9 + 0.0 |

## oasis / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 118 | 83 + 0 | 83 + 0 | 330 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 33.4 + 0.0 |
| fauna | 19 | 6 + 0 | 6 + 0 | 5.5 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 266.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 22 | 10 + 0 | 10 + 0 | 0.0 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| other world | 2 | 2 + 0 | 2 + 0 | 0.7 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 4 | 4 + 0 | 4 + 0 | 8.5 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 2.5 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 5.9 + 0.0 |

## dunes / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 99 | 78 + 0 | 78 + 0 | 220 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 0.0 |
| fauna | 7 | 4 + 0 | 4 + 0 | 14.4 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 16 | 8 + 0 | 8 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 18.1 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 13.1 + 0.0 |
| tree ring | 3 | 3 + 0 | 3 + 0 | 4.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |

## dunes / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 99 | 76 + 0 | 76 + 0 | 205 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 0.0 |
| fauna | 7 | 0 + 0 | 0 + 0 | 0.0 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 16 | 9 + 0 | 9 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 18.1 + 0.0 |
| outer ground | 4 | 3 + 0 | 3 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 13.1 + 0.0 |
| tree ring | 3 | 3 + 0 | 3 + 0 | 4.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |

## dunes / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 99 | 74 + 0 | 74 + 0 | 340 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 16.7 + 0.0 |
| fauna | 7 | 4 + 0 | 4 + 0 | 14.4 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 266.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 16 | 4 + 0 | 4 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 18.1 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 13.1 + 0.0 |
| tree ring | 3 | 3 + 0 | 3 + 0 | 4.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |

## grove / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 114 | 89 + 0 | 89 + 0 | 836 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 415.5 + 0.0 |
| fauna | 16 | 9 + 0 | 9 + 0 | 26.8 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 20 | 12 + 0 | 12 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 11.2 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 189.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 10.9 + 0.0 |

## grove / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 114 | 86 + 0 | 86 + 0 | 824 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 415.5 + 0.0 |
| fauna | 16 | 4 + 0 | 4 + 0 | 15.0 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 20 | 13 + 0 | 13 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| outer ground | 4 | 3 + 0 | 3 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 11.2 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 189.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 10.9 + 0.0 |

## grove / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 114 | 85 + 0 | 85 + 0 | 951 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 415.5 + 0.0 |
| fauna | 16 | 7 + 0 | 7 + 0 | 21.3 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 266.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 20 | 10 + 0 | 10 + 0 | 0.0 + 0.0 |
| light/weather/fx | 3 | 3 + 0 | 3 + 0 | 29.4 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 11.2 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 189.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 10.9 + 0.0 |

## frost / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 111 | 83 + 0 | 83 + 0 | 368 + 0 |
| bushes | 1 | 0 + 0 | 0 + 0 | 155.3 + 0.0 |
| fauna | 20 | 10 + 0 | 10 + 0 | 31.5 + 0.0 |
| fighters | 56 | 31 + 0 | 31 + 0 | 143.7 + 0.0 |
| ground | 1 | 0 + 0 | 0 + 0 | -1.1 + 0.0 |
| lantern halos | 16 | 7 + 0 | 7 + 0 | -2.3 + 0.0 |
| light/weather/fx | 2 | 1 + 0 | 1 + 0 | 1.5 + 0.0 |
| outer ground | 4 | 1 + 0 | 1 + 0 | -2.3 + 0.0 |
| props | 5 | 4 + 0 | 4 + 0 | 7.9 + 0.0 |
| tree ring | 1 | 0 + 0 | 0 + 0 | -0.8 + 0.0 |
| walls | 2 | 1 + 0 | 1 + 0 | 0.7 + 0.0 |
| water+shore | 3 | 2 + 0 | 2 + 0 | 8.0 + 0.0 |

## frost / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 111 | 84 + 0 | 84 + 0 | 350 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 157.6 + 0.0 |
| fauna | 20 | 7 + 0 | 7 + 0 | 13.4 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 16 | 11 + 0 | 11 + 0 | 0.0 + 0.0 |
| light/weather/fx | 2 | 2 + 0 | 2 + 0 | 3.8 + 0.0 |
| outer ground | 4 | 3 + 0 | 3 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 10.3 + 0.0 |
| tree ring | 1 | 0 + 0 | 0 + 0 | 0.3 + 0.0 |
| walls | 2 | 1 + 0 | 1 + 0 | 1.8 + 0.0 |
| water+shore | 3 | 2 + 0 | 2 + 0 | 9.2 + 0.0 |

## frost / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 111 | 80 + 0 | 80 + 0 | 484 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 157.6 + 0.0 |
| fauna | 20 | 9 + 0 | 9 + 0 | 27.0 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 266.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 16 | 6 + 0 | 6 + 0 | 0.0 + 0.0 |
| light/weather/fx | 2 | 2 + 0 | 2 + 0 | 3.8 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 5 | 5 + 0 | 5 + 0 | 10.3 + 0.0 |
| tree ring | 1 | 1 + 0 | 1 + 0 | 1.5 + 0.0 |
| walls | 2 | 3 + 0 | 3 + 0 | 4.2 + 0.0 |
| water+shore | 3 | 3 + 0 | 3 + 0 | 10.3 + 0.0 |

## isles / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 183 | 129 + 0 | 129 + 0 | 348 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 114.6 + 0.0 |
| fauna | 17 | 11 + 0 | 11 + 0 | 19.3 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 0.6 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| map kit | 101 | 61 + 0 | 61 + 0 | 30.9 + 0.0 |
| props | 3 | 3 + 0 | 3 + 0 | 8.6 + 0.0 |
| walls | 1 | 0 + 0 | 0 + 0 | 17.9 + 0.0 |
| windmill | 2 | 1 + 0 | 1 + 0 | 7.1 + 0.0 |

## isles / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 183 | 124 + 0 | 124 + 0 | 337 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 114.6 + 0.0 |
| fauna | 17 | 8 + 0 | 8 + 0 | 8.9 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 0.6 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| map kit | 101 | 59 + 0 | 59 + 0 | 30.2 + 0.0 |
| props | 3 | 3 + 0 | 3 + 0 | 8.6 + 0.0 |
| walls | 1 | 1 + 0 | 1 + 0 | 18.0 + 0.0 |
| windmill | 2 | 2 + 0 | 2 + 0 | 7.2 + 0.0 |

## isles / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 183 | 120 + 0 | 120 + 0 | 463 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 114.6 + 0.0 |
| fauna | 17 | 9 + 0 | 9 + 0 | 15.1 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 266.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 0.6 + 0.0 |
| light/weather/fx | 1 | 1 + 0 | 1 + 0 | 0.0 + 0.0 |
| map kit | 101 | 54 + 0 | 54 + 0 | 30.2 + 0.0 |
| props | 3 | 3 + 0 | 3 + 0 | 8.6 + 0.0 |
| walls | 1 | 1 + 0 | 1 + 0 | 18.0 + 0.0 |
| windmill | 2 | 2 + 0 | 2 + 0 | 7.2 + 0.0 |

## marsh / game view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 118 | 93 + 0 | 93 + 0 | 682 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 318.8 + 0.0 |
| fauna | 13 | 8 + 0 | 8 + 0 | 7.9 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 24 | 16 + 0 | 16 + 0 | 0.0 + 0.0 |
| light/weather/fx | 5 | 3 + 0 | 3 + 0 | 1.0 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 12.9 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 174.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 13.8 + 0.0 |

## marsh / edge view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 118 | 92 + 0 | 92 + 0 | 680 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 318.8 + 0.0 |
| fauna | 13 | 7 + 0 | 7 + 0 | 5.9 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 146.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 24 | 15 + 0 | 15 + 0 | 0.0 + 0.0 |
| light/weather/fx | 5 | 3 + 0 | 3 + 0 | 1.0 + 0.0 |
| outer ground | 4 | 3 + 0 | 3 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 12.9 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 174.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 13.8 + 0.0 |

## marsh / menu view
| category | nodes | draws (vis+shadow) | objects (vis+shadow) | primitives k (vis+shadow) |
|---|---:|---:|---:|---:|
| **total** | 118 | 87 + 0 | 87 + 0 | 802 + 0 |
| bushes | 1 | 1 + 0 | 1 + 0 | 318.8 + 0.0 |
| fauna | 13 | 8 + 0 | 8 + 0 | 7.9 + 0.0 |
| fighters | 56 | 32 + 0 | 32 + 0 | 266.0 + 0.0 |
| ground | 1 | 1 + 0 | 1 + 0 | 1.3 + 0.0 |
| lantern halos | 24 | 10 + 0 | 10 + 0 | 0.0 + 0.0 |
| light/weather/fx | 5 | 3 + 0 | 3 + 0 | 1.0 + 0.0 |
| outer ground | 4 | 2 + 0 | 2 + 0 | 0.0 + 0.0 |
| props | 6 | 6 + 0 | 6 + 0 | 12.9 + 0.0 |
| tree ring | 2 | 2 + 0 | 2 + 0 | 3.0 + 0.0 |
| walls | 2 | 2 + 0 | 2 + 0 | 174.0 + 0.0 |
| water+shore | 4 | 4 + 0 | 4 + 0 | 13.8 + 0.0 |
