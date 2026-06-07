import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../constants/colors.dart';

/// 头像组件
class Avatar extends StatelessWidget {
  final String name;
  final String? avatar;
  final String? avatarColor;
  final double size;

  const Avatar({
    super.key,
    required this.name,
    this.avatar,
    this.avatarColor,
    this.size = 40,
  });

  String get _initial => name.isNotEmpty ? name[0].toUpperCase() : '?';

  Color get _bgColor {
    if (avatarColor != null && avatarColor!.isNotEmpty) {
      try {
        return Color(int.parse(avatarColor!.replaceFirst('#', '0xFF')));
      } catch (e) {
        return AppColors.primary;
      }
    }
    return AppColors.primary;
  }

  @override
  Widget build(BuildContext context) {
    if (avatar != null && avatar!.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: avatar!,
        width: size,
        height: size,
        imageBuilder: (context, imageProvider) => Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            image: DecorationImage(image: imageProvider, fit: BoxFit.cover),
          ),
        ),
        placeholder: (context, url) => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _bgColor,
          ),
          child: Center(
            child: Text(
              _initial,
              style: TextStyle(
                color: Colors.white,
                fontSize: size * 0.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        errorWidget: (context, url, error) => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _bgColor,
          ),
          child: Center(
            child: Text(
              _initial,
              style: TextStyle(
                color: Colors.white,
                fontSize: size * 0.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _bgColor,
      ),
      child: Center(
        child: Text(
          _initial,
          style: TextStyle(
            color: Colors.white,
            fontSize: size * 0.4,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}