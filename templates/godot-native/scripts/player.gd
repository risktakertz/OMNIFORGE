# Player movement — original code (MIT). WASD/arrows via project.godot input actions.
extends CharacterBody3D

@export var speed: float = 6.0
@export var acceleration: float = 12.0
@export var gravity: float = 24.0

var _velocity_y: float = 0.0

func _physics_process(delta: float) -> void:
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var direction := (transform.basis * Vector3(input.x, 0, input.y)).normalized()

	var target := direction * speed
	var horizontal := Vector3(velocity.x, 0, velocity.z)
	horizontal = horizontal.lerp(target, acceleration * delta)
	_velocity_y -= gravity * delta
	velocity = Vector3(horizontal.x, _velocity_y, horizontal.z)
	move_and_slide()
	if is_on_floor():
		_velocity_y = 0.0
